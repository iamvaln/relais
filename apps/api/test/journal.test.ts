// Carnet de vie (Backend Specs §3.6, Techniques §10, E2-US07).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { GAMES } from '../src/api/checkin/games.js'
import { prisma } from '../src/lib/prisma.js'
import { api, closeAll, generateDeviceKeys, resetState, signWith, type DeviceKeys } from './helpers.js'
import { activateTransmission, makeOwner, opaque, signHash, type Owner } from './transmission-helpers.js'

beforeEach(resetState)
afterAll(closeAll)

function monthStart(offsetMonths = 0): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1)).toISOString().slice(0, 10)
}

describe('GET /journal/question', () => {
  it('rend la question journal du mois courant, mode essential par défaut', async () => {
    const o = await makeOwner()
    const r = await (await api()).get('/journal/question').set(o.auth).expect(200)
    expect(r.body.data).toMatchObject({ month: monthStart(), mode: 'essential', answered: false })
    const q = r.body.data.question
    const row = await prisma().checkin_questions.findUniqueOrThrow({ where: { id: q.id } })
    expect(row).toMatchObject({ usage_type: 'journal', status: 'active', mode_target: 'essential', cycle_month: new Date().getUTCMonth() + 1 })
    expect(q).toMatchObject({ text_fr: row.text_fr, text_en: row.text_en, category: row.category })
  })

  it('mode reflective : sa propre question ; mode free : aucune question', async () => {
    const o = await makeOwner()
    const reflective = await (await api()).get('/journal/question?mode=reflective').set(o.auth).expect(200)
    expect(reflective.body.data.mode).toBe('reflective')
    const row = await prisma().checkin_questions.findUniqueOrThrow({ where: { id: reflective.body.data.question.id } })
    expect(row.mode_target).toBe('reflective')
    const free = await (await api()).get('/journal/question?mode=free').set(o.auth).expect(200)
    expect(free.body.data).toMatchObject({ mode: 'free', question: null })
  })

  it('refuse un mode inconnu', async () => {
    const o = await makeOwner()
    const r = await (await api()).get('/journal/question?mode=poetic').set(o.auth).expect(400)
    expect(r.body.error.code).toBe('VALIDATION_ERROR')
  })
})

// --- Entrées (DEC-31 : écritures signées Ed25519) ---------------------------------

const content = (seed: number) => opaque(seed, 96)

/** Corps d'une entrée telle que l'app l'envoie : blob K2 + signature sur SHA256(blob). */
function entryBody(keys: DeviceKeys, seed: number, extra: Record<string, unknown> = {}) {
  const enc = content(seed)
  return { content_enc: enc.toString('base64'), signature: signHash(keys, enc), mode: 'essential', word_count_approx: 120, ...extra }
}

/** DELETE : signature sur SHA256 de l'identifiant (UUID en UTF-8). */
function deleteBody(keys: DeviceKeys, id: string) {
  return { signature: signWith(keys, createHash('sha256').update(id, 'utf8').digest()) }
}

async function journalQuestionId(mode = 'essential'): Promise<string> {
  const r = await prisma().checkin_questions.findFirstOrThrow({
    where: { usage_type: 'journal', status: 'active', cycle_month: new Date().getUTCMonth() + 1, mode_target: mode },
    select: { id: true },
  })
  return r.id
}

async function createEntry(o: Owner, seed = 1, extra: Record<string, unknown> = {}) {
  const r = await (await api()).post('/journal/entries').set(o.auth).send(entryBody(o.keys, seed, extra)).expect(201)
  return r.body.data as { id: string; month: string }
}

describe('POST /journal/entries', () => {
  it('crée l’entrée du mois : métadonnées en clair, contenu opaque, question rattachée', async () => {
    const o = await makeOwner()
    const qid = await journalQuestionId()
    const before = Date.now()
    const r = await (await api()).post('/journal/entries').set(o.auth).send(entryBody(o.keys, 1, { question_id: qid })).expect(201)
    expect(r.body.data).toMatchObject({ month: monthStart(), mode: 'essential', question_id: qid, word_count_approx: 120 })
    expect(r.body.data.content_enc).toBeUndefined()
    expect(Date.parse(r.body.data.created_at)).toBeGreaterThanOrEqual(before - 1000)
    const row = await prisma().journal_entries.findUniqueOrThrow({ where: { id: r.body.data.id } })
    expect(Buffer.from(row.content_enc)).toEqual(content(1))
    expect(row.entry_month.toISOString().slice(0, 10)).toBe(monthStart())

    const q = await (await api()).get('/journal/question').set(o.auth).expect(200)
    expect(q.body.data.answered).toBe(true)
  })

  it('accepte un mois passé explicite (rattrapage) et refuse un mois futur', async () => {
    const o = await makeOwner()
    const past = await createEntry(o, 2, { entry_month: monthStart(-2), mode: 'free' })
    expect(past.month).toBe(monthStart(-2))
    const r = await (await api()).post('/journal/entries').set(o.auth).send(entryBody(o.keys, 3, { entry_month: monthStart(1) })).expect(400)
    expect(r.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('DEC-31 : signature d’une autre clé → 401 ; sans clé enregistrée → 409', async () => {
    const o = await makeOwner()
    const impostor = generateDeviceKeys()
    const r = await (await api()).post('/journal/entries').set(o.auth).send(entryBody(impostor, 1)).expect(401)
    expect(r.body.error.code).toBe('AUTH_TOKEN_INVALID')
    expect(await prisma().journal_entries.count()).toBe(0)

    const { registerUser } = await import('./helpers.js')
    const u = await registerUser('sans-cle@example.cm')
    const r2 = await (await api()).post('/journal/entries').set('Authorization', `Bearer ${u.accessToken}`).send(entryBody(generateDeviceKeys(), 1)).expect(409)
    expect(r2.body.error.code).toBe('AUTH_KEY_NOT_SET')
  })

  it('une seule entrée par mois : la seconde → 409 JOURNAL_MONTH_TAKEN', async () => {
    const o = await makeOwner()
    await createEntry(o, 1)
    const r = await (await api()).post('/journal/entries').set(o.auth).send(entryBody(o.keys, 2)).expect(409)
    expect(r.body.error.code).toBe('JOURNAL_MONTH_TAKEN')
  })

  it('refuse une question qui n’est pas une question de carnet', async () => {
    const o = await makeOwner()
    const secret = await prisma().checkin_questions.findFirstOrThrow({ where: { usage_type: 'secret_question' }, select: { id: true } })
    const r = await (await api()).post('/journal/entries').set(o.auth).send(entryBody(o.keys, 1, { question_id: secret.id })).expect(400)
    expect(r.body.error.details.question_id).toBeDefined()
  })
})

describe('lien check-in ↔ carnet (Fix-09a, FK différée)', () => {
  async function checkedIn(o: Owner): Promise<string> {
    await activateTransmission(o)
    const game = (await (await api()).get('/checkin/game').set(o.auth).expect(200)).body.data
    const answer = GAMES.find((g) => g.id === game.game_id)!.answers.fr[0]!
    const token = (await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer }).expect(200)).body.data.checkin_token
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: token }).expect(200)
    const log = await prisma().checkin_log.findFirstOrThrow({ where: { user_id: o.userId } })
    return log.id
  }

  it('check-in d’abord, entrée ensuite (transactions séparées) : l’entrée se rattache au check-in du mois', async () => {
    const o = await makeOwner()
    const logId = await checkedIn(o)
    const entry = await createEntry(o, 1)
    const log = await prisma().checkin_log.findUniqueOrThrow({ where: { id: logId } })
    expect(log.journal_entry_id).toBe(entry.id)
  })

  it('supprimer l’entrée détache le check-in sans le supprimer', async () => {
    const o = await makeOwner()
    const logId = await checkedIn(o)
    const entry = await createEntry(o, 1)
    await (await api()).delete(`/journal/entries/${entry.id}`).set(o.auth).send(deleteBody(o.keys, entry.id)).expect(200)
    const log = await prisma().checkin_log.findUniqueOrThrow({ where: { id: logId } })
    expect(log.journal_entry_id).toBeNull()
  })
})

describe('GET /journal/entries et /journal/entries/:id', () => {
  it('la liste ne porte que des métadonnées, du plus récent au plus ancien ; le détail porte le contenu', async () => {
    const o = await makeOwner()
    await createEntry(o, 1, { entry_month: monthStart(-1) })
    const cur = await createEntry(o, 2)
    const list = await (await api()).get('/journal/entries').set(o.auth).expect(200)
    expect(list.body.data.map((e: { month: string }) => e.month)).toEqual([monthStart(), monthStart(-1)])
    expect(JSON.stringify(list.body.data)).not.toContain(content(2).toString('base64'))

    const one = await (await api()).get(`/journal/entries/${cur.id}`).set(o.auth).expect(200)
    expect(one.body.data.content_enc).toBe(content(2).toString('base64'))
  })

  it('GET /journal/entries/month/:ym (Backend v1.1 §6) : l’entrée du mois avec son contenu ; mois vide → 404 ; format invalide → 400', async () => {
    const o = await makeOwner()
    const e = await createEntry(o, 1)
    const r = await (await api()).get(`/journal/entries/month/${monthStart().slice(0, 7)}`).set(o.auth).expect(200)
    expect(r.body.data.id).toBe(e.id)
    expect(r.body.data.content_enc).toBe(content(1).toString('base64'))
    const empty = await (await api()).get('/journal/entries/month/2020-01').set(o.auth).expect(404)
    expect(empty.body.error.code).toBe('NOT_FOUND')
    await (await api()).get('/journal/entries/month/2026-1').set(o.auth).expect(400)
    await (await api()).get('/journal/entries/month/2026-13').set(o.auth).expect(400)
  })

  it('l’entrée d’un autre utilisateur est introuvable', async () => {
    const a = await makeOwner('a@example.cm')
    const b = await makeOwner('b@example.cm')
    const e = await createEntry(a, 1)
    await (await api()).get(`/journal/entries/${e.id}`).set(b.auth).expect(404)
    await (await api()).put(`/journal/entries/${e.id}`).set(b.auth).send(entryBody(b.keys, 2)).expect(404)
    await (await api()).delete(`/journal/entries/${e.id}`).set(b.auth).send(deleteBody(b.keys, e.id)).expect(404)
    expect(await prisma().journal_entries.count()).toBe(1)
  })
})

describe('PUT et DELETE /journal/entries/:id (DEC-31)', () => {
  it('PUT remplace le contenu signé ; une signature d’une autre clé est refusée', async () => {
    const o = await makeOwner()
    const e = await createEntry(o, 1)
    const r = await (await api()).put(`/journal/entries/${e.id}`).set(o.auth).send(entryBody(o.keys, 2, { mode: 'reflective', word_count_approx: 300 })).expect(200)
    expect(r.body.data).toMatchObject({ id: e.id, mode: 'reflective', word_count_approx: 300 })
    const row = await prisma().journal_entries.findUniqueOrThrow({ where: { id: e.id } })
    expect(Buffer.from(row.content_enc)).toEqual(content(2))

    const bad = await (await api()).put(`/journal/entries/${e.id}`).set(o.auth).send(entryBody(generateDeviceKeys(), 3)).expect(401)
    expect(bad.body.error.code).toBe('AUTH_TOKEN_INVALID')
    expect(Buffer.from((await prisma().journal_entries.findUniqueOrThrow({ where: { id: e.id } })).content_enc)).toEqual(content(2))
  })

  it('DELETE exige la signature de l’identifiant ; un token seul ne suffit pas', async () => {
    const o = await makeOwner()
    const e = await createEntry(o, 1)
    const noSig = await (await api()).delete(`/journal/entries/${e.id}`).set(o.auth).send({}).expect(400)
    expect(noSig.body.error.code).toBe('VALIDATION_ERROR')
    const wrong = await (await api()).delete(`/journal/entries/${e.id}`).set(o.auth).send(deleteBody(generateDeviceKeys(), e.id)).expect(401)
    expect(wrong.body.error.code).toBe('AUTH_TOKEN_INVALID')
    expect(await prisma().journal_entries.count()).toBe(1)

    const ok = await (await api()).delete(`/journal/entries/${e.id}`).set(o.auth).send(deleteBody(o.keys, e.id)).expect(200)
    expect(ok.body.data).toEqual({ deleted: true })
    expect(await prisma().journal_entries.count()).toBe(0)
    await (await api()).delete(`/journal/entries/${e.id}`).set(o.auth).send(deleteBody(o.keys, e.id)).expect(404)
  })
})

// --- Wrapped annuel (Techniques §10.3, DEC-32) --------------------------------------

const YEAR = new Date().getUTCFullYear()

function wrappedBody(keys: DeviceKeys, seed = 50) {
  const stats = opaque(seed, 64)
  return { stats_enc: stats.toString('base64'), signature: signHash(keys, stats) }
}

/** n entrées dans l'année courante, sur les mois qui précèdent (et incluent) le mois courant. */
async function entriesThisYear(o: Owner, n: number): Promise<void> {
  const month = new Date().getUTCMonth() // 0-based : il y a month+1 mois disponibles cette année
  if (n > month + 1) throw new Error(`pas assez de mois écoulés cette année pour ${n} entrées`)
  for (let i = 0; i < n; i++) await createEntry(o, 10 + i, { entry_month: monthStart(-i), mode: 'free' })
}

describe('POST /journal/wrapped/:year (DEC-32)', () => {
  it('moins de 6 entrées dans l’année → 409 WRAPPED_INSUFFICIENT_ENTRIES, rien n’est créé', async () => {
    const o = await makeOwner()
    await entriesThisYear(o, 2)
    const r = await (await api()).post(`/journal/wrapped/${YEAR}`).set(o.auth).send(wrappedBody(o.keys)).expect(409)
    expect(r.body.error.code).toBe('WRAPPED_INSUFFICIENT_ENTRIES')
    expect(r.body.error.details).toEqual({ current: 2, required: 6 })
    expect(await prisma().annual_wrappeds.count()).toBe(0)
  })

  it('6 entrées : le Wrapped est créé, entry_count recalculé côté serveur, puis mis à jour à la régénération', async () => {
    const o = await makeOwner()
    await entriesThisYear(o, 6)
    const r = await (await api()).post(`/journal/wrapped/${YEAR}`).set(o.auth).send(wrappedBody(o.keys)).expect(201)
    expect(r.body.data).toMatchObject({ year: YEAR, entry_count: 6, exported: false, exported_at: null })
    const row = await prisma().annual_wrappeds.findFirstOrThrow({ where: { user_id: o.userId } })
    expect(Buffer.from(row.stats_enc)).toEqual(opaque(50, 64))

    await createEntry(o, 99, { entry_month: monthStart(-6), mode: 'free' })
    const again = await (await api()).post(`/journal/wrapped/${YEAR}`).set(o.auth).send(wrappedBody(o.keys, 51)).expect(200)
    expect(again.body.data.entry_count).toBe(7)
    expect(await prisma().annual_wrappeds.count()).toBe(1)
    expect(Buffer.from((await prisma().annual_wrappeds.findUniqueOrThrow({ where: { id: row.id } })).stats_enc)).toEqual(opaque(51, 64))
  })

  it('DEC-31 : stats_enc signées par la clé de l’owner, sinon 401', async () => {
    const o = await makeOwner()
    await entriesThisYear(o, 6)
    const r = await (await api()).post(`/journal/wrapped/${YEAR}`).set(o.auth).send(wrappedBody(generateDeviceKeys())).expect(401)
    expect(r.body.error.code).toBe('AUTH_TOKEN_INVALID')
  })

  it('refuse une année avant 2026 ou dans le futur', async () => {
    const o = await makeOwner()
    await (await api()).post('/journal/wrapped/2025').set(o.auth).send(wrappedBody(o.keys)).expect(400)
    await (await api()).post(`/journal/wrapped/${YEAR + 1}`).set(o.auth).send(wrappedBody(o.keys)).expect(400)
  })
})

describe('GET /journal/wrapped/:year et export', () => {
  it('rend le Wrapped chiffré ; 404 s’il n’existe pas', async () => {
    const o = await makeOwner()
    await (await api()).get(`/journal/wrapped/${YEAR}`).set(o.auth).expect(404)
    await entriesThisYear(o, 6)
    await (await api()).post(`/journal/wrapped/${YEAR}`).set(o.auth).send(wrappedBody(o.keys)).expect(201)
    const r = await (await api()).get(`/journal/wrapped/${YEAR}`).set(o.auth).expect(200)
    expect(r.body.data).toMatchObject({ year: YEAR, entry_count: 6, stats_enc: opaque(50, 64).toString('base64'), exported: false })
  })

  it('export : métadonnées pour l’image (jamais de contenu), et POST marque l’export', async () => {
    const o = await makeOwner()
    await entriesThisYear(o, 6)
    await (await api()).post(`/journal/wrapped/${YEAR}`).set(o.auth).send(wrappedBody(o.keys)).expect(201)
    const meta = await (await api()).get(`/journal/wrapped/${YEAR}/export`).set(o.auth).expect(200)
    expect(meta.body.data).toMatchObject({ year: YEAR, entry_count: 6, watermark: 'relais.app', exported: false })
    expect(meta.body.data.stats_enc).toBeUndefined()

    const before = Date.now()
    const mark = await (await api()).post(`/journal/wrapped/${YEAR}/export`).set(o.auth).expect(200)
    expect(mark.body.data.exported).toBe(true)
    expect(Date.parse(mark.body.data.exported_at)).toBeGreaterThanOrEqual(before - 1000)
    expect((await (await api()).get(`/journal/wrapped/${YEAR}`).set(o.auth).expect(200)).body.data.exported).toBe(true)
  })
})
