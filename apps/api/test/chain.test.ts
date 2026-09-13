// services/chain : le client du contrat RelaisDms (docs/smart-contract-v2.md
// §3) contre un Anvil réel — lecture de l'état, écritures de l'opérateur,
// erreurs de revert nommées, solde et horloge. Pas de mock du RPC.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { readArtifact } from '../src/services/chain/artifact.js'
import { relaisDmsAbi } from '../src/services/chain/abi.js'
import { ChainRevertError, chainService, createChainService, type ChainService } from '../src/services/chain/index.js'
import { ANVIL_STRANGER_KEY, DAY, KEY_ENC_KEY, chainNow, nextDay, startAnvil, type AnvilHandle } from './chain-helpers.js'

const PK = `0x${'11'.repeat(32)}` as const
const SUBJECT = `0x${'ab'.repeat(32)}` as const
const SIG = `0x${'00'.repeat(64)}` as const

describe("l'ABI commitée suit l'artefact Foundry", () => {
  it('src/services/chain/abi.ts == contracts/out/RelaisDms.sol/RelaisDms.json (npm run chain:abi)', () => {
    expect(relaisDmsAbi).toEqual(readArtifact().abi)
  })
})

describe('chaîne désactivée', () => {
  it('chainService() est inerte : enabled=false, toute lecture ou écriture refuse clairement', async () => {
    const svc = chainService()
    expect(svc.enabled).toBe(false)
    await expect(svc.readDms(SUBJECT)).rejects.toThrow(/CHAIN_ENABLED/)
  })
})

describe('ChainService contre Anvil', () => {
  let anvil: AnvilHandle
  let svc: ChainService
  let subject: `0x${string}`

  beforeAll(async () => {
    anvil = await startAnvil()
    svc = createChainService({ rpcUrl: anvil.rpcUrl, contractAddress: anvil.contractAddress, operatorKeyEnc: anvil.operatorKeyEnc, keyEncKey: KEY_ENC_KEY })
    const { chainSubject } = await import('@relais/crypto-core')
    subject = chainSubject(Buffer.from(PK.slice(2), 'hex'))
  }, 60_000)

  afterAll(async () => {
    await anvil?.stop()
  })

  it('se présente : activé, adresse opérateur = compte Anvil n° 1, chainId 31337, solde positif', async () => {
    expect(svc.enabled).toBe(true)
    expect(svc.operatorAddress).toBe(anvil.operatorAddress)
    expect(await svc.chainId()).toBe(31337)
    expect(await svc.operatorBalanceWei()).toBeGreaterThan(0n)
    expect(await svc.blockNumber()).toBeGreaterThan(0n)
  })

  it('un sujet inconnu est inactive, avec des dates à zéro et un minuteur qui ne court pas', async () => {
    const d = await svc.readDms(subject)
    expect(d.status).toBe('inactive')
    expect(d.nextCheckinDue).toBe(0)
    expect(d.pausedUntil).toBe(0)
    expect(await svc.triggerable(subject)).toBe(false)
  })

  it('register écrit et attend le reçu ; l’état lu correspond ; le minuteur court', async () => {
    const due = nextDay(await chainNow(anvil.rpcUrl)) + 30 * DAY
    const r = await svc.write({ fn: 'register', args: [subject, PK, 2, 3, 90 * DAY, 30 * DAY, BigInt(due), SIG] })
    expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(r.blockNumber).toBeGreaterThan(0n)
    const d = await svc.readDms(subject)
    expect(d).toMatchObject({ status: 'active', n: 2, m: 3, silenceSecs: 90 * DAY, checkinFreqSecs: 30 * DAY, nextCheckinDue: due, pausedUntil: 0, ed25519Pk: PK })
    expect(await svc.secondsUntilTriggerable(subject)).toBeGreaterThan(100 * DAY)
  })

  it('un revert remonte comme ChainRevertError avec le nom de l’erreur du contrat', async () => {
    const due = nextDay(await chainNow(anvil.rpcUrl)) + 30 * DAY
    const err = await svc.write({ fn: 'register', args: [subject, PK, 2, 3, 90 * DAY, 30 * DAY, BigInt(due + 10 * DAY), SIG] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChainRevertError)
    expect((err as ChainRevertError).reason).toBe('BadStatus')
  })

  it('après le silence, n’importe qui déclenche ; lastTriggered le retrouve dans les événements', async () => {
    await anvil.warp(200 * DAY)
    expect(await svc.triggerable(subject)).toBe(true)
    const stranger = privateKeyToAccount(ANVIL_STRANGER_KEY)
    const wallet = createWalletClient({ account: stranger, chain: foundry, transport: http(anvil.rpcUrl) })
    await wallet.writeContract({ address: anvil.contractAddress, abi: relaisDmsAbi, functionName: 'trigger', args: [subject] })
    // attendre le minage
    await new Promise((r) => setTimeout(r, 200))
    const d = await svc.readDms(subject)
    expect(d.status).toBe('triggered')
    const t = await svc.lastTriggered(subject)
    expect(t).not.toBeNull()
    expect(t!.by.toLowerCase()).toBe(stranger.address.toLowerCase())
    expect(t!.at).toBe(d.triggeredAt)
    expect(t!.blockNumber).toBeGreaterThan(0n)
  })
})
