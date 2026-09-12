// Transmission côté app contre la vraie API (E3-US01 à US07, E2-US05, E6-US04,
// Techniques §7.2). Les contacts vivent chiffrés sur le device ; le serveur ne
// reçoit que sealed box, secret_enc et parts signées.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiClient, ApiError, MemoryCookieJar } from '@relais/api-client'
import { checkActivation, ContactStore, DeviceVault, MemorySecureStorage, Onboarding, PinGuard, Transmission } from '@relais/app-core'
import { deriveCategoryKeys, deriveSigningKeypair } from '@relais/crypto-core'
import { NodeSqlite } from '../../../packages/app-core/test/sqlite-node.js'
import { prisma } from '../src/lib/prisma.js'
import { trigger } from '../src/jobs/deadman.js'
import { closeAll, getApp, lastEmailTo, lastOtp, mailbox, resetRateLimits, resetState, STRONG_PASSWORD } from './helpers.js'

let baseUrl = ''
beforeAll(async () => {
  baseUrl = await (await getApp()).listen({ port: 0, host: '127.0.0.1' })
})
beforeEach(resetState)
afterAll(closeAll)

async function onboardedDevice() {
  const storage = new MemorySecureStorage()
  const api = new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' })
  const device = new DeviceVault(storage, new PinGuard(storage))
  const flow = new Onboarding({ api, device, language: 'fr', random: () => 0.5 })
  await flow.submitAccount({ full_name: 'Adjoua Ngo', email: 'adjoua@example.cm', phone: '+237699000000', password: STRONG_PASSWORD, language: 'fr' })
  await flow.submitOtp(lastOtp())
  const words = flow.state.words!
  const [a, b] = flow.confirmWordsNoted()
  flow.checkQuiz([words.split(' ')[a]!, words.split(' ')[b]!])
  const { seed } = await flow.submitPin('482913')
  flow.finish()
  const keys = await deriveCategoryKeys(seed)
  const signer = await deriveSigningKeypair(seed)
  return { api, keys, signer, words }
}

async function transmissionOn(d: Awaited<ReturnType<typeof onboardedDevice>>, db = new NodeSqlite()) {
  const store = new ContactStore(db, () => d.keys)
  await store.init()
  const tx = new Transmission({ api: d.api, store, keys: () => d.keys, signer: () => d.signer, ownerDisplayName: () => 'Adjoua' })
  return { tx, store, db }
}

const ANSWERS_1: [string, string, string] = ['Yaoundé', 'Rex', '1990']
const ANSWERS_2: [string, string, string] = ['Douala', 'Médor', '1985']

describe('transmission ↔ API', () => {
  it('questions de la bibliothèque, contacts, schéma, délais, récapitulatif, activation avec email de désignation ; contacts figés, puis parcours de modification', async () => {
    const d = await onboardedDevice()
    await resetRateLimits() // le parcours enchaîne plus de dix step-up dans la minute (dont set_key à l'onboarding)
    const { tx, store } = await transmissionOn(d)

    const questions = await tx.questions()
    expect(questions.length).toBeGreaterThanOrEqual(3)
    expect(questions[0]).toEqual({ id: expect.any(String), text_fr: expect.any(String), text_en: expect.any(String), category: expect.any(String), reliability_score: expect.any(Number) })
    const qids = questions.slice(0, 3).map((q) => q.id) as [string, string, string]

    // Rien à activer tant qu'il manque des contacts
    expect(checkActivation([], { n: 2, m: 2 })).toEqual({ ok: false, problems: [{ code: 'too_few_contacts' }] })

    const herve = await tx.saveContact({ name: 'Hervé Ngo', email: 'herve@example.cm', phone: '+237699000001', message: 'Merci petit frère', roles: { k1: true, k2: true, k3: false }, questionIds: qids, answers: ANSWERS_1 })
    expect(herve.serverId).toBeTypeOf('string')
    const paul = await tx.saveContact({ name: 'Paul', email: 'paul@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ANSWERS_2 })

    // Le serveur : deux contacts, blobs opaques
    const cfg = await tx.config()
    expect(cfg.status).toBe('inactive')
    expect(cfg.contacts.map((c) => c.id)).toEqual([herve.serverId, paul.serverId])
    const row = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id: herve.serverId! } })
    for (const clear of ['Hervé', 'herve@', 'Merci', 'Yaound']) {
      expect(Buffer.from(row.secret_enc).includes(Buffer.from(clear))).toBe(false)
      expect(Buffer.from(row.notification_enc).includes(Buffer.from(clear))).toBe(false)
    }

    // Modification avant activation : PUT avec step-up, la position ne bouge pas
    const edited = await tx.saveContact({ ...herve, phone: '+237699000002' }, herve.id)
    expect(edited.position).toBe(1)
    expect((await tx.config()).contacts[0]!.id).toBe(herve.serverId)

    // K3 n'a qu'un porteur : impossible en 2-of-2
    expect(checkActivation(await store.list(), { n: 2, m: 2 })).toEqual({ ok: false, problems: [{ code: 'role_holders_below_n', slot: 'k3', holders: 1 }] })
    await tx.saveContact({ ...edited, roles: { k1: true, k2: true, k3: true } }, herve.id)
    expect(checkActivation(await store.list(), { n: 2, m: 2 })).toEqual({ ok: true, problems: [] })

    await tx.setSchema({ n: 2, m: 2 })
    await tx.setConfig({ silence_duration_months: 6, checkin_frequency_weeks: 2 })
    mailbox.clear()
    expect(await tx.activate()).toEqual({ activated: true, contacts_notified: 2 })
    const after = await tx.config()
    expect(after).toMatchObject({ status: 'active', schema: { n: 2, m: 2 }, silence_duration_months: 6, checkin_frequency_weeks: 2 })
    expect(after.contacts.every((c) => c.shares.k1 && c.shares.k2 && c.shares.k3 && c.verify_token)).toBe(true)
    const mail = lastEmailTo('herve@example.cm')
    expect(mail?.subject).toContain('contact de confiance')
    expect(mail?.text).toContain('Adjoua')

    // Figé : le serveur refuse, l'app le sait avant d'appeler
    await expect(tx.saveContact({ ...edited, message: 'x' }, herve.id)).rejects.toMatchObject({ code: 'TRANSMISSION_ALREADY_ACTIVE' })
    expect(await tx.isEditable()).toBe(false)

    // Parcours guidé : désactiver (PIN côté écran), modifier, réactiver — parts recalculées, contacts reprévenus
    expect(await tx.deactivate()).toEqual({ deactivated: true })
    expect(await tx.isEditable()).toBe(true)
    await tx.saveContact({ ...edited, roles: { k1: true, k2: true, k3: true }, message: 'Nouveau message' }, herve.id)
    await tx.removeContact(paul.id)
    expect((await store.list()).map((c) => c.name)).toEqual(['Hervé Ngo'])
    expect(checkActivation(await store.list(), { n: 2, m: 2 })).toEqual({ ok: false, problems: [{ code: 'too_few_contacts' }] })
    await tx.saveContact({ name: 'Marie', email: 'marie@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ANSWERS_2 })
    mailbox.clear()
    expect(await tx.activate()).toEqual({ activated: true, contacts_notified: 2 })
    expect(lastEmailTo('marie@example.cm')?.subject).toContain('contact de confiance')
    expect((await tx.config()).contacts).toHaveLength(2)
  })

  it('vérification annuelle en local puis attestée ; pause et reprise ; nouveau device : contacts restaurés, réponses à ressaisir', async () => {
    const d = await onboardedDevice()
    const { tx } = await transmissionOn(d)
    const qids = (await tx.questions()).slice(0, 3).map((q) => q.id) as [string, string, string]
    const herve = await tx.saveContact({ name: 'Hervé Ngo', email: 'herve@example.cm', phone: '+237699000001', message: 'Merci', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ANSWERS_1 })
    await tx.saveContact({ name: 'Paul', email: 'paul@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ANSWERS_2 })
    await tx.activate()

    // Mauvaises réponses : détecté sur le device, le serveur n'est pas appelé
    expect(await tx.verifyContact(herve.id, ['faux', 'faux', 'faux'])).toEqual({ verified: false })
    let c = (await tx.config()).contacts[0]!
    expect(c.verify_last_checked_at).toBeNull()
    // Bonnes réponses (casse et accents indifférents) : attestation signée, datée par le serveur
    expect(await tx.verifyContact(herve.id, ['yaounde', 'REX', ' 1990 '])).toEqual({ verified: true })
    c = (await tx.config()).contacts[0]!
    expect(c.verify_last_checked_at).not.toBeNull()

    // Pause (E6-US04) puis reprise
    const paused = await tx.pause(30)
    expect(paused.status).toBe('paused')
    expect(Date.parse(paused.pause_until!)).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000)
    expect((await tx.resume()).status).toBe('active')

    // Nouveau device : mêmes clés (12 mots), base vide → contacts restaurés depuis secret_enc, sans les réponses
    const other = await transmissionOn(d)
    expect(await other.tx.restore()).toBe(2)
    const restored = await other.store.list()
    expect(restored.map((r) => [r.name, r.email, r.phone, r.message, r.serverId, r.position, r.answers])).toEqual([
      ['Hervé Ngo', 'herve@example.cm', '+237699000001', 'Merci', herve.serverId, 1, null],
      ['Paul', 'paul@example.cm', null, '', expect.any(String), 2, null],
    ])
    expect(restored[0]!.roles).toEqual({ k1: true, k2: true, k3: true })
    expect(restored[0]!.questionIds).toEqual(qids)
    // Réactiver depuis ce device demande les réponses
    expect(checkActivation(restored, { n: 2, m: 2 })).toEqual({ ok: false, problems: [{ code: 'missing_answers', contactId: restored[0]!.id }, { code: 'missing_answers', contactId: restored[1]!.id }] })
    await expect(other.tx.activate()).rejects.toThrow(/réponses/)
    // Restaurer une seconde fois ne duplique rien et garde les réponses déjà ressaisies
    await other.store.update(restored[0]!.id, { answers: ANSWERS_1 })
    expect(await other.tx.restore()).toBe(2)
    expect((await other.store.list()).map((r) => r.answers)).toEqual([ANSWERS_1, null])
  })

  it('transmission déclenchée à tort : l’owner l’annule depuis l’app (step-up cancel_transmission), sa configuration redevient active', async () => {
    const d = await onboardedDevice()
    const { tx } = await transmissionOn(d)
    const qids = (await tx.questions()).slice(0, 3).map((q) => q.id) as [string, string, string]
    await tx.saveContact({ name: 'Hervé Ngo', email: 'herve@example.cm', phone: '+237699000001', message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ANSWERS_1 })
    await tx.saveContact({ name: 'Paul', email: 'paul@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ANSWERS_2 })
    await tx.activate()
    await prisma().transmission_configs.updateMany({ where: { status: 'active' }, data: { status: 'triggered' } })
    await trigger(new Date())
    expect((await tx.config()).status).toBe('triggered')
    mailbox.clear()

    const r = await tx.cancelTriggered()
    expect(r.cancelled).toBe(true)
    expect(Date.parse(r.next_checkin_due)).toBeGreaterThan(Date.now())
    expect((await tx.config()).status).toBe('active')
    expect(lastEmailTo('herve@example.cm')?.text).toContain('annulée')
    await expect(tx.cancelTriggered()).rejects.toMatchObject({ code: 'TRANSMISSION_NOT_TRIGGERED' })
  })

  it('les erreurs de l’API remontent telles quelles (ApiError avec son code)', async () => {
    const d = await onboardedDevice()
    const { tx } = await transmissionOn(d)
    await expect(tx.pause(30)).rejects.toBeInstanceOf(ApiError)
    await expect(tx.setSchema({ n: 1, m: 2 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})
