// Lot 3a : l'app signe pour la chaîne (docs/smart-contract-v2.md §4). Parcours
// app-core contre la vraie API et un Anvil réel : chaque action qui engage le
// minuteur porte le champ `chain`, la file chain_sync se remplit, le drain
// confirme, l'état on-chain suit. Sans sujet on-chain, le premier check-in
// enregistre.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, MemoryCookieJar } from '@relais/api-client'
import { Checkin, ContactStore, DeviceVault, MemorySecureStorage, Onboarding, PinGuard, Transmission } from '@relais/app-core'
import { chainSubject, deriveCategoryKeys, deriveSigningKeypair } from '@relais/crypto-core'
import { NodeSqlite } from '../../../packages/app-core/test/sqlite-node.js'
import { GAMES } from '../src/api/checkin/games.js'
import { prisma } from '../src/lib/prisma.js'
import { sweep, trigger } from '../src/jobs/deadman.js'
import { createChainService, setChainServiceForTests, type ChainService } from '../src/services/chain/index.js'
import { drainChainQueue } from '../src/services/chain/sync.js'
import { closeAll, getApp, lastOtp, resetRateLimits, resetState, STRONG_PASSWORD } from './helpers.js'
import { DAY, KEY_ENC_KEY, startAnvil, type AnvilHandle } from './chain-helpers.js'

let baseUrl = ''
let anvil: AnvilHandle
let svc: ChainService

beforeAll(async () => {
  baseUrl = await (await getApp()).listen({ port: 0, host: '127.0.0.1' })
})
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

async function device() {
  const storage = new MemorySecureStorage()
  const api = new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' })
  const dv = new DeviceVault(storage, new PinGuard(storage))
  const flow = new Onboarding({ api, device: dv, language: 'fr', random: () => 0.5 })
  await flow.submitAccount({ full_name: 'Adjoua Ngo', email: 'adjoua@example.cm', phone: '+237699000000', password: STRONG_PASSWORD, language: 'fr' })
  await flow.submitOtp(lastOtp())
  const words = flow.state.words!
  const [a, b] = flow.confirmWordsNoted()
  flow.checkQuiz([words.split(' ')[a]!, words.split(' ')[b]!])
  const { seed } = await flow.submitPin('482913')
  flow.finish()
  const keys = await deriveCategoryKeys(seed)
  const signer = await deriveSigningKeypair(seed)
  const store = new ContactStore(new NodeSqlite(), () => keys)
  await store.init()
  const tx = new Transmission({ api, store, keys: () => keys, signer: () => signer })
  const checkin = new Checkin(api, { signer: () => signer, config: () => tx.config() })
  const userId = (await api.auth.me()).id
  await resetRateLimits()
  return { api, tx, checkin, userId, subject: chainSubject(signer.publicKey) }
}

async function withContacts(d: Awaited<ReturnType<typeof device>>) {
  const qids = (await d.tx.questions()).slice(0, 3).map((q) => q.id) as [string, string, string]
  await d.tx.saveContact({ name: 'Hervé', email: 'herve@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ['a', 'b', 'c'] })
  await d.tx.saveContact({ name: 'Paul', email: 'paul@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ['d', 'e', 'f'] })
}

async function rows(subject: string) {
  return (await prisma().chain_sync.findMany({ where: { subject }, orderBy: { created_at: 'asc' } })).map((r) => [r.action, r.status] as const)
}

async function winToken(d: Awaited<ReturnType<typeof device>>): Promise<string> {
  const game = await d.checkin.game()
  const good = await d.checkin.answer(GAMES.find((g) => g.id === game.game_id)!.answers.fr[0]!)
  if (!good.correct) throw new Error('inattendu')
  return good.checkin_token
}

describe('app-core → chaîne', () => {
  it('activation : register + setShareHashes signés par l’app ; drain → on-chain actif ; la config rend le sujet et la date', async () => {
    const d = await device()
    await withContacts(d)
    expect(await d.tx.activate()).toEqual({ activated: true, contacts_notified: 2 })
    expect(await rows(d.subject)).toEqual([['register', 'queued'], ['setShareHashes', 'queued']])
    expect(await drainChainQueue()).toMatchObject({ confirmed: 2 })
    const on = await svc.readDms(d.subject)
    expect(on).toMatchObject({ status: 'active', n: 2, m: 2, silenceSecs: 90 * DAY, checkinFreqSecs: 28 * DAY })
    const cfg = await d.tx.config()
    expect(cfg.chain.subject).toBe(d.subject)
    expect(cfg.chain.registered_at).toEqual(expect.any(String))
  })

  it('pause puis reprise : pause et resume signés ; désactivation : deactivate signé', async () => {
    const d = await device()
    await withContacts(d)
    await d.tx.activate()
    await drainChainQueue()
    await d.tx.pause(7)
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(d.subject)).status).toBe('paused')
    await d.tx.resume()
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(d.subject)).status).toBe('active')
    await d.tx.deactivate()
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(d.subject)).status).toBe('inactive')
    expect((await rows(d.subject)).map(([a]) => a)).toEqual(['register', 'setShareHashes', 'pause', 'resume', 'deactivate'])
  })

  it('check-in : checkin signé ; l’échéance on-chain avance', async () => {
    const d = await device()
    await withContacts(d)
    await d.tx.activate()
    await drainChainQueue()
    const before = (await svc.readDms(d.subject)).nextCheckinDue
    // même jour que l'activation : la même échéance ne passerait pas (strictement croissante) — on attend un jour
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.now() + DAY * 1000))
    const done = await d.checkin.complete(await winToken(d))
    expect(done.checked_in).toBe(true)
    expect((await rows(d.subject)).at(-1)).toEqual(['checkin', 'queued'])
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(d.subject)).nextCheckinDue).toBeGreaterThan(before)
  })

  it('compte activé sans chaîne : le premier check-in enregistre (register + setShareHashes)', async () => {
    const d = await device()
    await withContacts(d)
    setChainServiceForTests(undefined) // l'API ignore le champ : pas de sujet
    await d.tx.activate()
    expect((await d.tx.config()).chain.subject).toBeNull()
    setChainServiceForTests(svc)
    await d.checkin.complete(await winToken(d))
    expect(await rows(d.subject)).toEqual([['register', 'queued'], ['setShareHashes', 'queued']])
    expect(await drainChainQueue()).toMatchObject({ confirmed: 2 })
    expect((await svc.readDms(d.subject)).status).toBe('active')
    expect((await d.tx.config()).chain.registered_at).toEqual(expect.any(String))
  })

  it('sans sujet, pause et désactivation n’envoient rien : pas de 409, pas de ligne', async () => {
    const d = await device()
    await withContacts(d)
    setChainServiceForTests(undefined)
    await d.tx.activate()
    setChainServiceForTests(svc)
    await d.tx.pause(7)
    await d.tx.resume()
    await d.tx.deactivate()
    expect(await rows(d.subject)).toEqual([])
  })

  it('transmission déclenchée à tort : l’annulation par l’owner signe cancelTrigger, la chaîne redevient active', async () => {
    const d = await device()
    await withContacts(d)
    await d.tx.setConfig({ silence_duration_months: 1, checkin_frequency_weeks: 1 })
    await d.tx.activate()
    await drainChainQueue()
    // 7 j d'échéance + 30 j de silence : 40 jours suffisent, la session (90 j) survit au saut
    const shifted = new Date(Date.now() + 40 * DAY * 1000)
    await anvil.warp(40 * DAY)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(shifted)
    const NOW = new Date()
    await prisma().transmission_configs.update({ where: { user_id: d.userId }, data: { next_checkin_due: new Date(NOW.getTime() - 31 * DAY * 1000), relance_count: 3 } })
    expect(await sweep(NOW)).toMatchObject({ triggered: 1 })
    await trigger(NOW)
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(d.subject)).status).toBe('triggered')

    const r = await d.tx.cancelTriggered()
    expect(r.cancelled).toBe(true)
    expect((await rows(d.subject)).at(-1)).toEqual(['cancelTrigger', 'queued'])
    expect(await drainChainQueue()).toMatchObject({ confirmed: 1 })
    expect((await svc.readDms(d.subject)).status).toBe('active')
  })
})
