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
