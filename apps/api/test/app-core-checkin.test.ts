// Check-in et carnet de vie côté app, contre la vraie API (E4-US01, E4-US05,
// E2-US07, DEC-31/32). Le jeu vit côté serveur ; le carnet est chiffré sous
// K2 sur le device et relu déchiffré ; le Wrapped est calculé ici, puis
// déposé chiffré et signé.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiClient, MemoryCookieJar } from '@relais/api-client'
import { Checkin, ContactStore, DeviceVault, Journal, MemorySecureStorage, Onboarding, PinGuard, Transmission, wrappedStats } from '@relais/app-core'
import { deriveCategoryKeys, deriveSigningKeypair } from '@relais/crypto-core'
import { NodeSqlite } from '../../../packages/app-core/test/sqlite-node.js'
import { GAMES } from '../src/api/checkin/games.js'
import { prisma } from '../src/lib/prisma.js'
import { closeAll, getApp, lastOtp, resetState, STRONG_PASSWORD } from './helpers.js'

let baseUrl = ''
beforeAll(async () => {
  baseUrl = await (await getApp()).listen({ port: 0, host: '127.0.0.1' })
})
beforeEach(resetState)
afterAll(closeAll)

async function activatedDevice() {
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

  const store = new ContactStore(new NodeSqlite(), () => keys)
  await store.init()
  const tx = new Transmission({ api, store, keys: () => keys, signer: () => signer })
  const qids = (await tx.questions()).slice(0, 3).map((q) => q.id) as [string, string, string]
  await tx.saveContact({ name: 'Hervé', email: 'herve@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ['a', 'b', 'c'] })
  await tx.saveContact({ name: 'Paul', email: 'paul@example.cm', phone: null, message: '', roles: { k1: true, k2: true, k3: true }, questionIds: qids, answers: ['d', 'e', 'f'] })
  await tx.activate()

  const userId = (await api.auth.me()).id
  return { api, keys, signer, userId, checkin: new Checkin(api), journal: new Journal({ api, keys: () => keys, signer: () => signer }) }
}

function correctAnswer(gameId: string): string {
  return GAMES.find((g) => g.id === gameId)!.answers.fr[0]!
}

const thisMonth = new Date().toISOString().slice(0, 7)

describe('check-in ↔ API', () => {
  it('statut, jeu, mauvaise puis bonne réponse, validation : streak, badge, historique, échéance replanifiée', async () => {
    const d = await activatedDevice()
    let status = await d.checkin.status()
    expect(status).toMatchObject({ transmission_status: 'active', checked_in_this_month: false, overdue_days: 0 })

    const game = await d.checkin.game()
    expect(game.prompt).toBeTypeOf('string')
    expect(await d.checkin.answer('certainement pas')).toEqual({ correct: false, attempts: 1 })
    const good = await d.checkin.answer(correctAnswer(game.game_id))
    expect(good).toMatchObject({ correct: true, attempts: 2 })
    if (!good.correct) throw new Error('inattendu')

    const done = await d.checkin.complete(good.checkin_token)
    expect(done).toMatchObject({ checked_in: true, streak: 1, badge_earned: 'first_checkin', already_this_month: false })
    status = await d.checkin.status()
    expect(status.checked_in_this_month).toBe(true)
    expect(Date.parse(status.next_checkin_due!)).toBeGreaterThan(Date.now() + 27 * 24 * 3600 * 1000)
    expect(await d.checkin.streak()).toEqual({ current: 1, longest: 1, badges: ['first_checkin'] })
    const history = await d.checkin.history()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ month: `${thisMonth}-01`, attempts: 2, badge_earned: 'first_checkin' })
  })

  it('sans transmission active, le statut le dit et le jeu est refusé avec son code', async () => {
    const storage = new MemorySecureStorage()
    const api = new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' })
    const flow = new Onboarding({ api, device: new DeviceVault(storage, new PinGuard(storage)), language: 'fr', random: () => 0.5 })
    await flow.submitAccount({ full_name: 'Adjoua Ngo', email: 'adjoua@example.cm', phone: '+237699000000', password: STRONG_PASSWORD, language: 'fr' })
    await flow.submitOtp(lastOtp())
    const checkin = new Checkin(api)
    expect((await checkin.status()).transmission_status).toBe('inactive')
    await expect(checkin.game()).rejects.toMatchObject({ code: 'TRANSMISSION_NOT_CONFIGURED' })
  })
})

describe('carnet ↔ API', () => {
  it('question du mois, entrée chiffrée et signée, relecture, réécriture du même mois, rattachement au check-in, suppression signée', async () => {
    const d = await activatedDevice()
    const q = await d.journal.question('essential')
    expect(q.month).toBe(`${thisMonth}-01`)
    expect(q.question).not.toBeNull()
    expect(q.answered).toBe(false)
    expect((await d.journal.question('free')).question).toBeNull()

    const entry = await d.journal.save({ mode: 'essential', questionId: q.question!.id, texte: 'Un mois ordinaire, mais doux.' })
    expect(entry).toMatchObject({ month: `${thisMonth}-01`, mode: 'essential', question_id: q.question!.id, word_count_approx: 5 })
    const row = await prisma().journal_entries.findUniqueOrThrow({ where: { id: entry.id } })
    expect(Buffer.from(row.content_enc).includes(Buffer.from('ordinaire'))).toBe(false)

    expect((await d.journal.entries()).map((e) => e.id)).toEqual([entry.id])
    const read = await d.journal.read(entry.id)
    expect(read.clear).toEqual({ question_id: q.question!.id, entry_month: `${thisMonth}-01`, mode: 'essential', texte: 'Un mois ordinaire, mais doux.' })
    expect((await d.journal.readMonth(thisMonth))?.clear.texte).toBe('Un mois ordinaire, mais doux.')
    expect(await d.journal.readMonth('2025-01')).toBeNull()

    // Réécrire le mois : même identifiant, contenu remplacé (409 JOURNAL_MONTH_TAKEN géré)
    const again = await d.journal.save({ mode: 'reflective', questionId: null, texte: 'Finalement, un grand mois.' })
    expect(again.id).toBe(entry.id)
    expect((await d.journal.read(entry.id)).clear).toMatchObject({ mode: 'reflective', question_id: null, texte: 'Finalement, un grand mois.' })
    expect((await d.journal.question('essential')).answered).toBe(true)

    // Le check-in du mois se rattache à l'entrée existante (E2-US07) : l'app passe son identifiant
    const game = await d.checkin.game()
    const good = await d.checkin.answer(correctAnswer(game.game_id))
    if (!good.correct) throw new Error('inattendu')
    await d.checkin.complete(good.checkin_token, entry.id)
    expect((await d.checkin.history())[0]!.journal_entry_id).toBe(entry.id)

    await d.journal.remove(entry.id)
    expect(await d.journal.entries()).toEqual([])
    expect((await d.checkin.history())[0]!.journal_entry_id).toBeNull()
  })

  it('Wrapped : refusé sous 6 entrées ; ensuite calculé ici, déposé chiffré et signé, relu déchiffré, export daté', async () => {
    const d = await activatedDevice()
    const now = new Date()
    const year = now.getUTCMonth() + 1 >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
    await expect(d.journal.buildWrapped(year)).rejects.toMatchObject({ code: 'WRAPPED_INSUFFICIENT_ENTRIES' })

    const texts = ['Janvier calme', 'Février et ses pluies', 'Mars, un voyage à Kribi', 'Avril', 'Mai en famille', 'Juin, la fin du chantier enfin']
    for (const [i, texte] of texts.entries()) {
      await d.journal.save({ month: `${year}-0${i + 1}-01`, mode: i % 2 === 0 ? 'essential' : 'free', questionId: null, texte })
    }
    const w = await d.journal.buildWrapped(year)
    expect(w.stats).toEqual({
      year,
      entries: 6,
      words: 21,
      modes: { essential: 3, reflective: 0, free: 3 },
      months: [`${year}-01-01`, `${year}-02-01`, `${year}-03-01`, `${year}-04-01`, `${year}-05-01`, `${year}-06-01`],
      longest: { month: `${year}-06-01`, words: 6 },
    })
    expect(w.view.entry_count).toBe(6)
    const row = await prisma().annual_wrappeds.findFirstOrThrow({ where: { user_id: d.userId } })
    expect(Buffer.from(row.stats_enc).includes(Buffer.from('essential'))).toBe(false)

    expect((await d.journal.wrapped(year))?.stats).toEqual(w.stats)
    // Une année sans Wrapped : null (404) — ou 400 si l'année précède 2026, la première de Relais
    const other = await d.journal.wrapped(year - 1).catch((err: unknown) => err)
    expect(other === null || (other as { code?: string }).code === 'VALIDATION_ERROR').toBe(true)
    expect((await d.journal.markExported(year)).exported).toBe(true)
  })

  it('wrappedStats est pur et déterministe', () => {
    expect(wrappedStats(2026, [])).toEqual({ year: 2026, entries: 0, words: 0, modes: { essential: 0, reflective: 0, free: 0 }, months: [], longest: null })
    expect(
      wrappedStats(2026, [
        { entry_month: '2026-03-01', mode: 'free', question_id: null, texte: 'deux mots' },
        { entry_month: '2026-01-01', mode: 'essential', question_id: null, texte: 'un' },
      ]),
    ).toEqual({ year: 2026, entries: 2, words: 3, modes: { essential: 1, reflective: 0, free: 1 }, months: ['2026-01-01', '2026-03-01'], longest: { month: '2026-03-01', words: 2 } })
  })
})
