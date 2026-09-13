// Réconciliation quotidienne (docs/smart-contract-v2.md §3) : la base reste
// maître, la chaîne est comparée ; les écarts remontent au tableau de bord
// (chain_divergence), le solde de l'opérateur aussi (chain_gas_low). Un
// `Triggered` posé par un tiers n'ouvre la transmission que si
// CHAIN_TRUST_TRIGGERS le permet — après le mois de miroir.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { keys, redis } from '../src/lib/redis.js'
import { prisma } from '../src/lib/prisma.js'
import { createChainService, relaisDmsAbi, setChainServiceForTests, type ChainService } from '../src/services/chain/index.js'
import { drainChainQueue } from '../src/services/chain/sync.js'
import { GAS_LOW_WEI, reconcile } from '../src/services/chain/reconcile.js'
import { api, closeAll, mailbox, resetState } from './helpers.js'
import { loginAdmin } from './admin-helpers.js'
import { activateTransmission, makeOwner } from './transmission-helpers.js'
import { ANVIL_STRANGER_KEY, DAY, KEY_ENC_KEY, activateOnChain, startAnvil, subjectOf, type AnvilHandle } from './chain-helpers.js'

let anvil: AnvilHandle
let svc: ChainService

beforeEach(async () => {
  await resetState()
  anvil = await startAnvil()
  svc = createChainService({ rpcUrl: anvil.rpcUrl, contractAddress: anvil.contractAddress, operatorKeyEnc: anvil.operatorKeyEnc, keyEncKey: KEY_ENC_KEY })
  setChainServiceForTests(svc)
}, 60_000)
afterEach(async () => {
  setChainServiceForTests(undefined)
  await anvil?.stop()
})
afterAll(closeAll)

/** Un tiers déclenche on-chain après le silence (Anvil avance de 200 jours). */
async function strangerTriggers(subject: `0x${string}`): Promise<void> {
  await anvil.warp(200 * DAY)
  const wallet = createWalletClient({ account: privateKeyToAccount(ANVIL_STRANGER_KEY), chain: foundry, transport: http(anvil.rpcUrl) })
  await wallet.writeContract({ address: anvil.contractAddress, abi: relaisDmsAbi, functionName: 'trigger', args: [subject] })
  await new Promise((r) => setTimeout(r, 200))
  expect((await svc.readDms(subject)).status).toBe('triggered')
}

describe('reconcile', () => {
  it('base et chaîne d’accord : aucun écart ; le résumé et le solde sont en Redis ; la santé admin décrit la chaîne', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const r = await reconcile()
    expect(r).toMatchObject({ checked: 1, opened: 0, divergences: [] })

    const last = JSON.parse((await redis().get(keys.chainReconcile())) ?? 'null')
    expect(last).toMatchObject({ checked: 1, divergences: 0 })
    expect(BigInt((await redis().get(keys.chainBalance())) ?? '0')).toBeGreaterThan(GAS_LOW_WEI)

    const sa = await loginAdmin()
    const health = (await (await api()).get('/admin/health').set(sa.auth).expect(200)).body.data
    expect(health.chain).toMatchObject({ enabled: true, chain_id: 31337, operator_address: anvil.operatorAddress, queued: 0, failed: 0 })
    expect(Number(health.chain.operator_balance_eth)).toBeGreaterThan(1)
    expect(health.chain.last_reconcile).toMatchObject({ checked: 1, divergences: 0 })
    const dash = (await (await api()).get('/admin/dashboard').set(sa.auth).expect(200)).body.data
    expect(dash.alerts.filter((a: { type: string }) => a.type.startsWith('chain_'))).toEqual([])
  })

  it('une transmission active jamais enregistrée on-chain est un écart `unregistered`, visible au tableau de bord', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const r = await reconcile()
    expect(r.checked).toBe(1)
    expect(r.divergences).toEqual([{ subject: null, user_id: o.userId, type: 'unregistered' }])
    const sa = await loginAdmin()
    const dash = (await (await api()).get('/admin/dashboard').set(sa.auth).expect(200)).body.data
    expect(dash.alerts).toContainEqual({ type: 'chain_divergence', severity: 'medium', count: 1, types: { unregistered: 1 } })
  })

  it('une échéance qui a bougé en base sans passer par la chaîne est un écart `next_due`', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { next_checkin_due: new Date(Date.now() + 40 * DAY * 1000) } })
    const r = await reconcile()
    expect(r.divergences).toEqual([expect.objectContaining({ subject: subjectOf(o), type: 'next_due' })])
  })

  it('un `Triggered` tiers en mode miroir : écart `chain_triggered`, la base ne bouge pas ; avec CHAIN_TRUST_TRIGGERS la transmission s’ouvre', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const subject = subjectOf(o)
    await strangerTriggers(subject)
    const NOW = new Date(Date.now() + 200 * DAY * 1000)

    const mirror = await reconcile(NOW, { trustTriggers: false })
    expect(mirror.opened).toBe(0)
    expect(mirror.divergences).toEqual([expect.objectContaining({ subject, type: 'chain_triggered' })])
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).status).toBe('active')
    expect(await prisma().transmissions.count({ where: { user_id: o.userId } })).toBe(0)

    mailbox.clear()
    const trusted = await reconcile(NOW, { trustTriggers: true })
    expect(trusted.opened).toBe(1)
    expect(trusted.divergences).toEqual([])
    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.status).toBe('triggered')
    const tr = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId } })
    expect(tr.status).toBe('triggered')
    expect(tr.arbitrum_trigger_block).toBe((await svc.lastTriggered(subject))!.blockNumber.toString())
    expect(mailbox.sent.filter((m) => m.to.startsWith('contact') && /\/relay\//.test(m.text))).toHaveLength(2)
    // le `trigger` que startTransmission enfile est déjà satisfait : skipped, pas de transaction
    expect(await drainChainQueue()).toMatchObject({ skipped: 1, confirmed: 0 })
    // et une seconde réconciliation n'ouvre rien de plus
    expect((await reconcile(NOW, { trustTriggers: true })).opened).toBe(0)
  })

  it('une ligne en file depuis plus de 24 h ou une écriture refusée sont des écarts `stale_queue` / `failed_write`', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const subject = subjectOf(o)
    await prisma().chain_sync.create({ data: { subject, action: 'checkin', args: { nextDue: 0, ownerSig: '0x' }, created_at: new Date(Date.now() - 25 * 3600 * 1000) } })
    await prisma().chain_sync.create({ data: { subject, action: 'pause', args: {}, status: 'failed', error: 'BadStatus' } })
    const r = await reconcile()
    expect(r.divergences.map((d) => d.type).sort()).toEqual(['failed_write', 'stale_queue'])
  })

  it('un solde opérateur sous 0,01 ETH lève chain_gas_low (haute)', async () => {
    await redis().set(keys.chainBalance(), (GAS_LOW_WEI - 1n).toString())
    const sa = await loginAdmin()
    const dash = (await (await api()).get('/admin/dashboard').set(sa.auth).expect(200)).body.data
    expect(dash.alerts).toContainEqual({ type: 'chain_gas_low', severity: 'high', count: 1, operator_balance_eth: expect.any(String) })
  })
})
