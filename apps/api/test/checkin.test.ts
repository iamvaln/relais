import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { GAMES } from '../src/api/checkin/games.js'
import { api, closeAll, registerUser, resetState } from './helpers.js'
import { activateTransmission, makeOwner } from './transmission-helpers.js'

const DAY = 24 * 3600 * 1000

beforeEach(resetState)
afterAll(closeAll)

describe('GET /checkin/status', () => {
  it('sans transmission : statut inactive, aucune échéance', async () => {
    const { accessToken } = await registerUser('adjoua@example.cm')
    const r = await (await api()).get('/checkin/status').set('Authorization', `Bearer ${accessToken}`).expect(200)
    expect(r.body.data).toEqual({
      transmission_status: 'inactive',
      checkin_frequency_weeks: 4,
      next_checkin_due: null,
      last_checkin_at: null,
      overdue_days: 0,
      relance_count: 0,
      checked_in_this_month: false,
    })
  })

  it('transmission active : échéance à + fréquence, pas de retard', async () => {
    const o = await makeOwner()
    const before = Date.now()
    await activateTransmission(o, { frequency: 2 })
    const r = await (await api()).get('/checkin/status').set(o.auth).expect(200)
    expect(r.body.data).toMatchObject({ transmission_status: 'active', checkin_frequency_weeks: 2, overdue_days: 0, relance_count: 0 })
    expect(Date.parse(r.body.data.next_checkin_due) - before).toBeGreaterThan(13.99 * DAY)
    expect(Date.parse(r.body.data.last_checkin_at)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('échéance dépassée : compte les jours de retard', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await prisma().transmission_configs.update({
      where: { user_id: o.userId },
      data: { next_checkin_due: new Date(Date.now() - 10.5 * DAY), relance_count: 1 },
    })
    const r = await (await api()).get('/checkin/status').set(o.auth).expect(200)
    expect(r.body.data).toMatchObject({ overdue_days: 10, relance_count: 1 })
  })
})

describe('GET /checkin/history', () => {
  it('vide tant qu’aucun check-in n’a été validé', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const r = await (await api()).get('/checkin/history').set(o.auth).expect(200)
    expect(r.body.data).toEqual([])
  })
})

// --- Mini-jeu ---------------------------------------------------------------------

function answerFor(gameId: string): string {
  const g = GAMES.find((x) => x.id === gameId)
  if (!g) throw new Error(`jeu inconnu : ${gameId}`)
  return g.answers.fr[0]!
}

describe('GET /checkin/game', () => {
  it('exige une transmission active', async () => {
    const o = await makeOwner()
    const r = await (await api()).get('/checkin/game').set(o.auth).expect(409)
    expect(r.body.error.code).toBe('TRANSMISSION_NOT_CONFIGURED')
  })

  it('rend un défi de la bibliothèque, dans la langue de l’owner, sans la réponse, et le même tant qu’il est en cours', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const r = await (await api()).get('/checkin/game').set(o.auth).expect(200)
    const { game_id, game_type, prompt, choices, attempts } = r.body.data
    expect(['riddle', 'sequence', 'sort']).toContain(game_type)
    expect(prompt).toBeTypeOf('string')
    expect(attempts).toBe(0)
    const g = GAMES.find((x) => x.id === game_id)!
    expect(prompt).toBe(g.prompt.fr)
    for (const a of g.answers.fr) expect(JSON.stringify({ prompt, choices })).not.toContain(a)
    const again = await (await api()).get('/checkin/game').set(o.auth).expect(200)
    expect(again.body.data.game_id).toBe(game_id)
  })
})

describe('POST /checkin/game/answer', () => {
  it('sans défi en cours → 404', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const r = await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: 'x' }).expect(404)
    expect(r.body.error.code).toBe('NOT_FOUND')
    expect(r.body.error.message).toMatch(/défi/)
  })

  it('mauvaise réponse : compte la tentative sans pénalité ; bonne réponse : checkin_token, défi clos', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const game = (await (await api()).get('/checkin/game').set(o.auth).expect(200)).body.data
    const wrong = await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: 'certainement pas' }).expect(200)
    expect(wrong.body.data).toEqual({ correct: false, attempts: 1 })
    expect((await (await api()).get('/checkin/game').set(o.auth).expect(200)).body.data.attempts).toBe(1)

    const good = await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: answerFor(game.game_id) }).expect(200)
    expect(good.body.data).toMatchObject({ correct: true, attempts: 2 })
    expect(good.body.data.checkin_token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    // le défi est consommé : un nouveau GET en tire un autre (ou le même par hasard, mais à 0 tentative)
    expect((await (await api()).get('/checkin/game').set(o.auth).expect(200)).body.data.attempts).toBe(0)
  })

  it('tolère casse, accents et espaces', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const game = (await (await api()).get('/checkin/game').set(o.auth).expect(200)).body.data
    const raw = answerFor(game.game_id)
    const mangled = `  ${raw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}  `
    const r = await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: mangled }).expect(200)
    expect(r.body.data.correct).toBe(true)
  })

  it('est limité à 10 réponses par heure et par utilisateur (§7.1)', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await (await api()).get('/checkin/game').set(o.auth).expect(200)
    for (let i = 0; i < 10; i++) await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: 'non' }).expect(200)
    const r = await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: 'non' }).expect(429)
    expect(r.body.error.code).toBe('RATE_LIMITED')
  })
})

// --- Validation du check-in, streak, badges ------------------------------------------

async function winToken(o: Awaited<ReturnType<typeof makeOwner>>): Promise<string> {
  const game = (await (await api()).get('/checkin/game').set(o.auth).expect(200)).body.data
  const r = await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: answerFor(game.game_id) }).expect(200)
  return r.body.data.checkin_token as string
}

function monthStart(offsetMonths: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1))
}

/** Une ligne checkin_log posée à la main pour un mois passé. */
async function pastCheckin(userId: string, offsetMonths: number, streak: number, badge: string | null = null) {
  const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: userId }, select: { id: true } })
  await prisma().checkin_log.create({
    data: {
      user_id: userId,
      transmission_id: cfg.id,
      checkin_month: monthStart(offsetMonths),
      game_completed_at: monthStart(offsetMonths),
      streak_at_checkin: streak,
      badge_earned: badge,
    },
  })
}

describe('POST /checkin/complete', () => {
  it('refuse un jeton inconnu ou déjà consommé', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const r = await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: 'x'.repeat(43) }).expect(401)
    expect(r.body.error.code).toBe('AUTH_TOKEN_INVALID')
    const token = await winToken(o)
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: token }).expect(200)
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: token }).expect(401)
  })

  it('premier check-in : ligne du mois, streak 1, badge first_checkin, échéance replanifiée, relances remises à zéro', async () => {
    const o = await makeOwner()
    await activateTransmission(o, { frequency: 2 })
    await prisma().transmission_configs.update({
      where: { user_id: o.userId },
      data: { next_checkin_due: new Date(Date.now() - 3 * DAY), relance_count: 2, last_relance_at: new Date() },
    })
    const token = await winToken(o)
    const before = Date.now()
    const r = await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: token }).expect(200)
    expect(r.body.data).toMatchObject({
      checked_in: true,
      month: monthStart(0).toISOString().slice(0, 10),
      streak: 1,
      badge_earned: 'first_checkin',
      already_this_month: false,
    })
    expect(Date.parse(r.body.data.next_checkin_due) - before).toBeGreaterThan(13.99 * DAY)

    const rows = await prisma().checkin_log.findMany({ where: { user_id: o.userId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ attempts: 1, streak_at_checkin: 1, badge_earned: 'first_checkin' })
    expect(['riddle', 'sequence', 'sort']).toContain(rows[0]!.game_type)

    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.relance_count).toBe(0)
    expect(cfg.last_relance_at).toBeNull()
    expect(cfg.last_checkin_at!.getTime()).toBeGreaterThanOrEqual(before - 1000)

    const status = await (await api()).get('/checkin/status').set(o.auth).expect(200)
    expect(status.body.data).toMatchObject({ checked_in_this_month: true, overdue_days: 0, relance_count: 0 })
  })

  it('second check-in du même mois : pas de nouvelle ligne, mais l’échéance est replanifiée', async () => {
    const o = await makeOwner()
    await activateTransmission(o, { frequency: 1 })
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o) }).expect(200)
    await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { next_checkin_due: new Date(Date.now() - DAY) } })
    const before = Date.now()
    const r = await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o) }).expect(200)
    expect(r.body.data).toMatchObject({ checked_in: true, streak: 1, badge_earned: null, already_this_month: true })
    expect(Date.parse(r.body.data.next_checkin_due) - before).toBeGreaterThan(6.99 * DAY)
    expect(await prisma().checkin_log.count({ where: { user_id: o.userId } })).toBe(1)
  })

  it('prolonge le streak du mois précédent et pose streak_3', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await pastCheckin(o.userId, -2, 1, 'first_checkin')
    await pastCheckin(o.userId, -1, 2)
    const r = await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o) }).expect(200)
    expect(r.body.data).toMatchObject({ streak: 3, badge_earned: 'streak_3' })
  })

  it('un mois sauté remet le streak à 1, sans badge', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await pastCheckin(o.userId, -3, 5, 'streak_3')
    const r = await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o) }).expect(200)
    expect(r.body.data).toMatchObject({ streak: 1, badge_earned: null })
  })

  it('lie une entrée de carnet du mois (journal_entry_id), refuse une entrée inconnue', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    const ghost = '00000000-0000-4000-8000-000000000000'
    const r1 = await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o), journal_entry_id: ghost }).expect(404)
    expect(r1.body.error.code).toBe('NOT_FOUND')
    expect(r1.body.error.message).toMatch(/carnet/)

    const entry = await prisma().journal_entries.create({
      data: { user_id: o.userId, entry_month: monthStart(0), content_enc: new Uint8Array([1, 2, 3]) },
      select: { id: true },
    })
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o), journal_entry_id: entry.id }).expect(200)
    const row = await prisma().checkin_log.findFirstOrThrow({ where: { user_id: o.userId } })
    expect(row.journal_entry_id).toBe(entry.id)
  })
})

describe('GET /checkin/streak', () => {
  it('streak courant, record et badges', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await pastCheckin(o.userId, -7, 1, 'first_checkin')
    await pastCheckin(o.userId, -6, 2)
    await pastCheckin(o.userId, -5, 3, 'streak_3')
    await pastCheckin(o.userId, -2, 1)
    await pastCheckin(o.userId, -1, 2)
    const r = await (await api()).get('/checkin/streak').set(o.auth).expect(200)
    expect(r.body.data).toEqual({ current: 2, longest: 3, badges: ['first_checkin', 'streak_3'] })
  })

  it('un streak interrompu depuis plus d’un mois vaut 0', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await pastCheckin(o.userId, -3, 4)
    const r = await (await api()).get('/checkin/streak').set(o.auth).expect(200)
    expect(r.body.data).toMatchObject({ current: 0, longest: 4 })
  })

  it('la liste des check-ins validés apparaît dans l’historique, du plus récent au plus ancien', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await pastCheckin(o.userId, -1, 1, 'first_checkin')
    await (await api()).post('/checkin/complete').set(o.auth).send({ checkin_token: await winToken(o) }).expect(200)
    const r = await (await api()).get('/checkin/history').set(o.auth).expect(200)
    expect(r.body.data.map((x: { month: string }) => x.month)).toEqual([monthStart(0), monthStart(-1)].map((d) => d.toISOString().slice(0, 10)))
    expect(r.body.data[0]).toMatchObject({ streak: 2, badge_earned: null })
  })
})
