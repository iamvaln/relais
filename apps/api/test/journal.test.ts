// Carnet de vie (Backend Specs §3.6, Techniques §10, E2-US07).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { api, closeAll, resetState } from './helpers.js'
import { makeOwner } from './transmission-helpers.js'

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
