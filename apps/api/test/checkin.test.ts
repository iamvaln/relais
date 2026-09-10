import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
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
