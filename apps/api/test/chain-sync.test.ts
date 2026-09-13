// Le miroir on-chain (docs/smart-contract-v2.md §3) : chaque action de l'owner
// qui engage le minuteur porte `chain` { next_due | paused_until, sig } ; l'API
// vérifie la signature Ed25519 sur le message canonique, enfile une ligne
// chain_sync, et le worker (drainChainQueue) l'écrit sur un Anvil réel.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainFields } from '@relais/crypto-core'
import { prisma } from '../src/lib/prisma.js'
import { createChainService, setChainServiceForTests, type ChainService } from '../src/services/chain/index.js'
import { drainChainQueue, enqueueChainWrite } from '../src/services/chain/sync.js'
import { sweep } from '../src/jobs/deadman.js'
import { purgeTransmission } from '../src/api/relay/service.js'
import { api, closeAll, resetState, stepUp } from './helpers.js'
import { activateTransmission, makeOwner, type Owner } from './transmission-helpers.js'
import { DAY, KEY_ENC_KEY, activateOnChain, chainSig, dueIn, nextDay, relogin, startAnvil, subjectOf, winToken, type AnvilHandle } from './chain-helpers.js'

let anvil: AnvilHandle
let svc: ChainService

// Un Anvil neuf par test : certains avancent l'horloge de la chaîne de 200 jours,
// et une date signée « dans le passé » du contrat ferait échouer les suivants.
beforeEach(async () => {
  await resetState()
  anvil = await startAnvil()
  svc = createChainService({ rpcUrl: anvil.rpcUrl, contractAddress: anvil.contractAddress, operatorKeyEnc: anvil.operatorKeyEnc, keyEncKey: KEY_ENC_KEY })
  setChainServiceForTests(svc)
}, 60_000)
afterEach(async () => {
  vi.useRealTimers()
  setChainServiceForTests(undefined)
  await anvil?.stop()
})
afterAll(closeAll)

async function rows(subject: string) {
  return prisma().chain_sync.findMany({ where: { subject }, orderBy: { created_at: 'asc' } })
}

describe('activation → register + setShareHashes', () => {
  it('signature valide : lignes en file, drain → confirmées, état on-chain = paramètres signés, config marquée enregistrée', async () => {
    const o = await makeOwner()
    const { r, next_due } = await activateOnChain(o)
    expect(r.status).toBe(200)
    const subject = subjectOf(o)
    let q = await rows(subject)
    expect(q.map((x) => [x.action, x.status])).toEqual([['register', 'queued'], ['setShareHashes', 'queued']])

    expect(await drainChainQueue()).toMatchObject({ confirmed: 2, skipped: 0, failed: 0, waiting: 0 })
    q = await rows(subject)
    expect(q.every((x) => x.status === 'confirmed' && /^0x[0-9a-f]{64}$/.test(x.tx_hash ?? ''))).toBe(true)

    const d = await svc.readDms(subject)
    expect(d).toMatchObject({ status: 'active', n: 2, m: 2, silenceSecs: 90 * DAY, checkinFreqSecs: 28 * DAY, nextCheckinDue: next_due })
    expect(d.ed25519Pk).toBe(`0x${o.keys.publicKeyRaw.toString('hex')}`)
    expect(await svc.shareHashes(subject)).toHaveLength(2)

    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.chain_subject).toBe(subject)
    expect(cfg.contract_registered).toBe(true)
    expect(cfg.chain_registered_at).not.toBeNull()
    const view = (await (await api()).get('/transmission/config').set(o.auth).expect(200)).body.data
    expect(view.chain).toEqual({ subject, registered_at: cfg.chain_registered_at!.toISOString() })
  })

  it('signature invalide : 400 CHAIN_SIG_INVALID avant toute écriture — rien d’activé, rien en file', async () => {
    const o = await makeOwner()
    const { r } = await activateOnChain(o, { sig: Buffer.alloc(64, 1).toString('base64') })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('CHAIN_SIG_INVALID')
    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.status).toBe('inactive')
    expect(await rows(subjectOf(o))).toHaveLength(0)
  })

  it('une échéance signée trop loin de celle de l’API (± 2 jours) : 400 CHAIN_FIELDS_MISMATCH', async () => {
    const o = await makeOwner()
    const { r } = await activateOnChain(o, { next_due: dueIn(4) + 10 * DAY })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('CHAIN_FIELDS_MISMATCH')
    const o2 = await makeOwner('bintou@example.cm')
    // pas aligné au jour : crypto-core refuserait de signer, l'API doit refuser avant même de regarder la signature
    const bad = await activateOnChain(o2, { next_due: dueIn(4) + 1, sig: Buffer.alloc(64, 1).toString('base64') })
    expect(bad.r.status).toBe(400)
    expect(bad.r.body.error.code).toBe('CHAIN_FIELDS_MISMATCH')
  })

  it('sans `chain` : activation normale, rien en file, config non enregistrée', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    expect(await rows(subjectOf(o))).toHaveLength(0)
    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.chain_subject).toBeNull()
    expect(cfg.contract_registered).toBe(false)
    const view = (await (await api()).get('/transmission/config').set(o.auth).expect(200)).body.data
    expect(view.chain).toEqual({ subject: null, registered_at: null })
  })
})

describe('check-in → checkin', () => {
  it('avance l’échéance on-chain, le hash de transaction rejoint checkin_log ; une répétition est skipped', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const subject = subjectOf(o)
    const next_due = dueIn(4)
    // l'activation vient d'avoir lieu : la même échéance au jour près — on force le lendemain pour avancer strictement
    const due = next_due + DAY
    const sig = chainSig(o, 'checkin', { nextDue: due })
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o), chain: { next_due: due, sig } }).expect(200)
    expect((await rows(subject)).at(-1)).toMatchObject({ action: 'checkin', status: 'queued' })
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(subject)).nextCheckinDue).toBe(due)
    const log = await prisma().checkin_log.findFirstOrThrow({ where: { user_id: o.userId } })
    expect(log.arbitrum_tx_hash).toMatch(/^0x[0-9a-f]{64}$/)

    // la même écriture rejouée : l'état la satisfait déjà → skipped, pas de transaction
    await enqueueChainWrite({ subject, action: 'checkin', args: { nextDue: due, ownerSig: sig } })
    expect(await drainChainQueue()).toMatchObject({ confirmed: 0, skipped: 1 })
  })

  it('un compte activé avant la chaîne s’enregistre à son prochain check-in (chain.action = register)', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const subject = subjectOf(o)
    const due = dueIn(4) + DAY
    const fields: ChainFields = { nextDue: due, n: 2, m: 2, silenceSecs: 90 * DAY, checkinFreqSecs: 28 * DAY }
    await (await api())
      .post('/checkin/complete')
      .set(o.auth)
      .send({ checkin_token: await winToken(o), chain: { action: 'register', next_due: due, sig: chainSig(o, 'register', fields) } })
      .expect(200)
    expect((await rows(subject)).map((x) => x.action)).toEqual(['register', 'setShareHashes'])
    await drainChainQueue()
    expect((await svc.readDms(subject)).status).toBe('active')
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).contract_registered).toBe(true)
  })

  it('une signature checkin pour un compte jamais enregistré : 409 CHAIN_NOT_REGISTERED', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const due = dueIn(4) + DAY
    const r = await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o), chain: { next_due: due, sig: chainSig(o, 'checkin', { nextDue: due }) } })
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('CHAIN_NOT_REGISTERED')
  })
})

describe('chaîne désactivée', () => {
  it('le champ `chain` est accepté et ignoré : rien en file', async () => {
    setChainServiceForTests(undefined) // env de test : CHAIN_ENABLED=false
    try {
      const o = await makeOwner()
      const { r } = await activateOnChain(o)
      expect(r.status).toBe(200)
      expect(await rows(subjectOf(o))).toHaveLength(0)
    } finally {
      setChainServiceForTests(svc)
    }
  })
})

describe('pause → pause, reprise → resume', () => {
  it('la pause pose pausedUntil on-chain ; la reprise repart active avec la nouvelle échéance', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const subject = subjectOf(o)
    const paused_until = nextDay(Math.floor(Date.now() / 1000) + 30 * DAY)
    const su = await stepUp(o.accessToken, 'edit_transmission')
    await (await api())
      .post('/transmission/pause')
      .set(o.auth)
      .set('X-Step-Up-Token', su)
      .send({ duration_days: 30, chain: { paused_until, sig: chainSig(o, 'pause', { pausedUntil: paused_until }) } })
      .expect(200)
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect(await svc.readDms(subject)).toMatchObject({ status: 'paused', pausedUntil: paused_until })

    const next_due = dueIn(4) + DAY
    await (await api()).delete('/transmission/pause').set(o.auth).send({ chain: { next_due, sig: chainSig(o, 'resume', { nextDue: next_due }) } }).expect(200)
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect(await svc.readDms(subject)).toMatchObject({ status: 'active', pausedUntil: 0, nextCheckinDue: next_due })
  })

  it('une reprise sans `chain` reprend en base et n’écrit rien : la chaîne expire la pause elle-même (D3)', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const su = await stepUp(o.accessToken, 'edit_transmission')
    await (await api()).post('/transmission/pause').set(o.auth).set('X-Step-Up-Token', su).send({ duration_days: 7 }).expect(200)
    await (await api()).delete('/transmission/pause').set(o.auth).expect(200)
    expect((await rows(subjectOf(o))).map((x) => x.action)).toEqual(['register', 'setShareHashes'])
  })
})

/**
 * Active on-chain puis déclenche : Anvil avance de 200 jours et l'horloge de
 * l'API (Date) avec lui — comme en production, les deux horloges s'accordent.
 * L'échéance en base est repoussée dans le passé, le balayage déclenche.
 * Les jetons émis avant le saut sont périmés : `relogin` en redonne.
 */
async function triggerOnChain(o: Owner) {
  await activateOnChain(o)
  await drainChainQueue()
  const subject = subjectOf(o)
  const shifted = new Date(Date.now() + 200 * DAY * 1000)
  await anvil.warp(200 * DAY)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(shifted)
  const NOW = new Date()
  await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { next_checkin_due: new Date(NOW.getTime() - 91 * DAY * 1000), relance_count: 3 } })
  expect(await sweep(NOW)).toMatchObject({ triggered: 1 })
  const { trigger } = await import('../src/jobs/deadman.js')
  await trigger(NOW)
  const tr = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId } })
  return { subject, transmissionId: tr.id, NOW }
}

describe('déclenchement → trigger, annulation → cancelTrigger, purge → complete', () => {
  it('le balayage deadman enfile trigger ; le drain le pose on-chain et note le bloc sur la transmission', async () => {
    const o = await makeOwner()
    const { subject, transmissionId } = await triggerOnChain(o)
    expect((await rows(subject)).at(-1)).toMatchObject({ action: 'trigger', status: 'queued', ref_id: transmissionId })
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(subject)).status).toBe('triggered')
    const tr = await prisma().transmissions.findUniqueOrThrow({ where: { id: transmissionId } })
    expect(tr.arbitrum_trigger_block).toMatch(/^\d+$/)
  })

  it('un trigger pas encore déclenchable on-chain attend (waiting) au lieu d’échouer, et retient les lignes suivantes du sujet', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const subject = subjectOf(o)
    // base en retard, chaîne pas encore : pas de warp
    const NOW = new Date()
    await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { next_checkin_due: new Date(NOW.getTime() - 91 * DAY * 1000), relance_count: 3 } })
    await sweep(NOW)
    const { trigger } = await import('../src/jobs/deadman.js')
    await trigger(NOW)
    await enqueueChainWrite({ subject, action: 'complete', args: {} })
    expect(await drainChainQueue()).toMatchObject({ confirmed: 0, waiting: 2, failed: 0 })
    expect((await rows(subject)).filter((x) => x.status === 'queued')).toHaveLength(2)
  })

  it('l’owner vivant annule : cancelTrigger rend le sujet actif avec l’échéance signée', async () => {
    const o = await makeOwner()
    const { subject } = await triggerOnChain(o)
    await drainChainQueue()
    await relogin(o)
    const next_due = dueIn(4) + DAY
    const su = await stepUp(o.accessToken, 'cancel_transmission')
    await (await api())
      .post('/transmission/cancel')
      .set(o.auth)
      .set('X-Step-Up-Token', su)
      .send({ chain: { next_due, sig: chainSig(o, 'cancelTrigger', { nextDue: next_due }) } })
      .expect(200)
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect(await svc.readDms(subject)).toMatchObject({ status: 'active', triggeredAt: 0, nextCheckinDue: next_due })
  })

  it('la purge après confirmation enfile complete : le sujet est Completed, la config n’est plus enregistrée', async () => {
    const o = await makeOwner()
    const { subject, transmissionId, NOW } = await triggerOnChain(o)
    await drainChainQueue()
    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    await purgeTransmission(transmissionId, o.userId, cfg.id, NOW)
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(subject)).status).toBe('completed')
    const after = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(after.contract_registered).toBe(false)
    expect(after.chain_subject).toBe(subject)
  })

  it('après une annulation admin (sans signature owner), un check-in signé `checkin` échoue proprement : failed BadStatus, la réconciliation le verra', async () => {
    const o = await makeOwner()
    const { subject } = await triggerOnChain(o)
    await drainChainQueue()
    // ce que fait l'annulation admin côté base
    await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { status: 'active', next_checkin_due: new Date(Date.now() + 28 * DAY * 1000), relance_count: 0 } })
    await prisma().transmissions.updateMany({ where: { user_id: o.userId }, data: { status: 'cancelled' } })
    await relogin(o)
    const due = dueIn(4) + DAY
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o), chain: { next_due: due, sig: chainSig(o, 'checkin', { nextDue: due }) } }).expect(200)
    expect(await drainChainQueue()).toMatchObject({ failed: 1 })
    expect((await rows(subject)).at(-1)).toMatchObject({ action: 'checkin', status: 'failed', error: 'BadStatus' })
  })
})

describe('désactivation → deactivate', () => {
  it('signée par l’owner : le sujet redevient Inactive, la config n’est plus enregistrée mais garde son sujet', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    await drainChainQueue()
    const subject = subjectOf(o)
    const su = await stepUp(o.accessToken, 'delete_transmission')
    await (await api()).delete('/transmission').set(o.auth).set('X-Step-Up-Token', su).send({ chain: { sig: chainSig(o, 'deactivate', {}) } }).expect(200)
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(subject)).status).toBe('inactive')
    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.contract_registered).toBe(false)
    expect(cfg.chain_subject).toBe(subject)
  })

  it('une signature deactivate fausse : 400, la transmission reste active', async () => {
    const o = await makeOwner()
    await activateOnChain(o)
    const su = await stepUp(o.accessToken, 'delete_transmission')
    const r = await (await api()).delete('/transmission').set(o.auth).set('X-Step-Up-Token', su).send({ chain: { sig: Buffer.alloc(64, 2).toString('base64') } })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('CHAIN_SIG_INVALID')
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).status).toBe('active')
  })
})
