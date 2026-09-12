// Le parcours du contact (E5-US01 à US05, F4) contre la vraie API : lien reçu,
// réponses vérifiées sur le device, attente de l'autre contact, accès
// déverrouillé (coffre, message personnel, carnet), « J'ai terminé ».
// Les réponses ne quittent jamais le device ; Relais ne combine jamais les parts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiClient, MemoryCookieJar } from '@relais/api-client'
import { ApiVaultTransport, ContactStore, DeviceVault, Journal, LocalVault, MemorySecureStorage, Onboarding, PinGuard, RelayFlow, Transmission, VaultSync } from '@relais/app-core'
import { deriveCategoryKeys, deriveSigningKeypair } from '@relais/crypto-core'
import { NodeSqlite } from '../../../packages/app-core/test/sqlite-node.js'
import { trigger } from '../src/jobs/deadman.js'
import { prisma } from '../src/lib/prisma.js'
import { closeAll, getApp, lastEmailTo, lastOtp, mailbox, resetRateLimits, resetState, STRONG_PASSWORD } from './helpers.js'

let baseUrl = ''
beforeAll(async () => {
  baseUrl = await (await getApp()).listen({ port: 0, host: '127.0.0.1' })
})
beforeEach(resetState)
afterAll(closeAll)

const HERVE: [string, string, string] = ['Yaoundé', 'Rex', '1990']
const PAUL: [string, string, string] = ['Douala', 'Médor', '1985']

/** Adjoua : compte, coffre synchronisé, carnet, transmission activée avec Hervé et Paul (K1 et K2 chacun ; personne ne porte K3). */
async function adjoua() {
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
  const userId = (await api.auth.me()).id

  const db = new NodeSqlite()
  const sync = new VaultSync({ transport: new ApiVaultTransport(api), keys: () => keys, signer: () => signer, debounceMs: 0 })
  const vault = new LocalVault(db, () => keys, { onChange: (c) => sync.markDirty(c) })
  await vault.init()
  sync.attach(vault)
  await vault.add({ category: 'accounts', service_name: 'Orange Money', login: '+237699000000', password: 'S3cret!', instructions: 'Appelle le 8008, demande la clôture.', urgency: 'immediate' })
  await vault.add({ category: 'accounts', service_name: 'Gmail', login: 'adjoua@gmail.com', urgency: 'within_30_days' })
  await vault.add({ category: 'messages', service_name: 'Lettre à maman', notes: 'Je vous aime.', urgency: 'discretion' })
  await vault.add({ category: 'finances', service_name: 'Ecobank', login: '0012345', urgency: 'immediate' })
  await sync.flushAll()

  const journal = new Journal({ api, keys: () => keys, signer: () => signer })
  await journal.save({ month: '2026-03-01', mode: 'essential', questionId: null, texte: 'Mars, un voyage à Kribi.' })

  const store = new ContactStore(db, () => keys)
  await store.init()
  const tx = new Transmission({ api, store, keys: () => keys, signer: () => signer, ownerDisplayName: () => 'Adjoua' })
  const qids = (await tx.questions()).slice(0, 3).map((q) => q.id) as [string, string, string]
  await tx.saveContact({ name: 'Hervé Ngo', email: 'herve@example.cm', phone: null, message: 'Merci pour tout, petit frère.', roles: { k1: true, k2: true, k3: false }, questionIds: qids, answers: HERVE })
  await tx.saveContact({ name: 'Paul', email: 'paul@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: false }, questionIds: qids, answers: PAUL })
  await tx.activate()

  // Silence prolongé : le job ouvre la transmission et écrit aux contacts
  await prisma().transmission_configs.update({ where: { user_id: userId }, data: { status: 'triggered' } })
  mailbox.clear()
  await trigger(new Date())
  const tokenOf = (email: string) => {
    const m = /\/relay\/([A-Za-z0-9_-]{32,})/.exec(lastEmailTo(email)?.text ?? '')
    if (!m) throw new Error(`pas de lien dans l'email à ${email}`)
    return m[1]!
  }
  return { userId, qids, tokens: { herve: tokenOf('herve@example.cm'), paul: tokenOf('paul@example.cm') } }
}

function contactDevice() {
  const api = new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' })
  const storage = new MemorySecureStorage()
  return { flow: new RelayFlow({ api, storage }), storage }
}

describe('parcours du contact ↔ API', () => {
  it('lien, réponses vérifiées sur le device, attente, déverrouillage 2-of-2, checklist et message, carnet pour K2, progression, J’ai terminé, purge', async () => {
    const { userId, qids, tokens } = await adjoua()
    const herve = contactDevice()
    const paul = contactDevice()

    // E5-US01 : le lien ouvre sur le nom de l'owner et trois questions
    const link = await herve.flow.link(tokens.herve)
    expect(link.owner_name).toBe('Adjoua Ngo')
    expect(link.questions.map((q) => q.id)).toEqual(qids)
    expect(link.roles).toEqual({ k1: true, k2: true, k3: false })
    expect(link.status).toBe('triggered')

    // E5-US02 : mauvaises réponses détectées sur le device, déclarées au serveur (tentatives comptées)
    const wrong = await herve.flow.answer(tokens.herve, link, ['faux', 'faux', 'faux'])
    expect(wrong).toEqual({ ok: false, attempts_left: 4 })
    const good = await herve.flow.answer(tokens.herve, link, ['yaounde', 'REX', ' 1990 '])
    expect(good).toMatchObject({ ok: true, answered: 1, needed: 2, unlocked: { k1: false, k2: false, k3: false } })

    // E5-US03 : en attente de l'autre contact
    const waiting = await herve.flow.status(tokens.herve)
    expect(waiting).toMatchObject({ contact_status: 'answered', answered: 1, needed: 2, total: 2 })
    await expect(herve.flow.unlock(tokens.herve)).rejects.toMatchObject({ code: 'RELAY_NOT_UNLOCKED' })

    await resetRateLimits()
    const paulLink = await paul.flow.link(tokens.paul)
    const paulOk = await paul.flow.answer(tokens.paul, paulLink, PAUL)
    expect(paulOk).toMatchObject({ ok: true, answered: 2, unlocked: { k1: true, k2: true, k3: false } })

    // E5-US04 : accès déverrouillé — coffre par catégorie et urgence, message personnel, carnet (K2)
    const access = await herve.flow.unlock(tokens.herve)
    expect(access.owner_name).toBe('Adjoua Ngo')
    expect(access.message).toEqual({ nom: 'Hervé Ngo', role: 'k1,k2', message_personnel: 'Merci pour tout, petit frère.', email: 'herve@example.cm', phone: null })
    expect(access.unlocked).toEqual({ k1: true, k2: true, k3: false })
    expect(access.categories.accounts?.map((i) => [i.service_name, i.password ?? null, i.urgency])).toEqual([
      ['Orange Money', 'S3cret!', 'immediate'],
      ['Gmail', null, 'within_30_days'],
    ])
    expect(access.categories.messages?.map((i) => i.notes)).toEqual(['Je vous aime.'])
    expect(access.categories.finances).toBeUndefined()
    expect(access.journal?.map((e) => [e.entry_month, e.mode, e.texte])).toEqual([['2026-03-01', 'essential', 'Mars, un voyage à Kribi.']])
    expect(access.checklist.map((s) => [s.urgency, s.items.map((i) => i.service_name)])).toEqual([
      ['immediate', ['Orange Money']],
      ['within_30_days', ['Gmail']],
      ['discretion', ['Lettre à maman']],
    ])
    expect(Date.parse(access.access_expires_at)).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000)

    // Paul n'a pas de message personnel ; les finances (K3, sans porteur) ne sont jamais déverrouillées
    const paulAccess = await paul.flow.unlock(tokens.paul)
    expect(paulAccess.message?.message_personnel).toBe('')
    expect(Object.keys(paulAccess.categories).sort()).toEqual(['accounts', 'messages'])

    // Progression « Fait », gardée sur le device (pas le token en clair), relue à la prochaine ouverture
    const orange = access.categories.accounts![0]!.id
    await herve.flow.markDone(tokens.herve, orange, true, access.access_expires_at)
    expect(await herve.flow.progress(tokens.herve)).toEqual([orange])
    const again = new RelayFlow({ api: new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' }), storage: herve.storage })
    expect(await again.progress(tokens.herve)).toEqual([orange])

    // E5-US05 : « J'ai terminé » — la transmission se termine quand chaque contact ayant répondu a confirmé
    await resetRateLimits()
    expect(await herve.flow.confirm(tokens.herve)).toEqual({ confirmed: true, transmission_status: 'in_progress' })
    expect(await paul.flow.confirm(tokens.paul)).toEqual({ confirmed: true, transmission_status: 'completed' })
    expect(await prisma().journal_entries.count({ where: { user_id: userId } })).toBe(0)
    await expect(herve.flow.link(tokens.herve)).rejects.toMatchObject({ code: 'RELAY_TOKEN_INVALID' })
    expect(await herve.flow.progress(tokens.herve)).toEqual([])
  })

  it('cinq mauvaises réponses : le lien est bloqué 24 h, l’erreur porte la date', async () => {
    const { tokens } = await adjoua()
    const herve = contactDevice()
    const link = await herve.flow.link(tokens.herve)
    for (let i = 0; i < 4; i++) {
      await resetRateLimits()
      expect(await herve.flow.answer(tokens.herve, link, ['a', 'b', 'c'])).toEqual({ ok: false, attempts_left: 4 - i })
    }
    await resetRateLimits()
    await expect(herve.flow.answer(tokens.herve, link, ['a', 'b', 'c'])).rejects.toMatchObject({ code: 'RELAY_TOKEN_EXHAUSTED' })
    await expect(herve.flow.link(tokens.herve)).rejects.toMatchObject({ code: 'RELAY_CONTACT_BLOCKED' })
  })
})
