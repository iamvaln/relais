// Dashboard back office (BO-01) : KPIs et alertes calculables.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { loginAdmin } from './admin-helpers.js'
import { api, closeAll, registerUser, resetState } from './helpers.js'
import { activateTransmission, makeOwner, openTransmission } from './transmission-helpers.js'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

beforeEach(resetState)
afterAll(closeAll)

describe('GET /admin/dashboard — KPIs (BO-01)', () => {
  it('rôle admin ou super_admin ; support et finance refusés', async () => {
    const support = await loginAdmin('support')
    await (await api()).get('/admin/dashboard').set(support.auth).expect(403)
    const finance = await loginAdmin('finance')
    await (await api()).get('/admin/dashboard').set(finance.auth).expect(403)
    const admin = await loginAdmin('admin')
    await (await api()).get('/admin/dashboard').set(admin.auth).expect(200)
  })

  it('les huit KPIs de la spec, calculés sur la base', async () => {
    const sa = await loginAdmin()
    // A : active, à jour. B : active, en retard. C : déclenchée ce mois. D : complétée ce mois.
    const a = await makeOwner('a@example.cm')
    await activateTransmission(a)
    const b = await makeOwner('b@example.cm')
    await activateTransmission(b)
    await prisma().transmission_configs.update({ where: { user_id: b.userId }, data: { next_checkin_due: new Date(Date.now() - 3 * DAY) } })
    const c = await makeOwner('c@example.cm')
    await openTransmission(c)
    const d = await makeOwner('d@example.cm')
    const { transmissionId } = await openTransmission(d)
    await prisma().transmissions.update({ where: { id: transmissionId }, data: { status: 'completed', completed_at: new Date() } })
    // B dort depuis 40 jours. E : compte supprimé (RGPD). (5 inscriptions : la limite par IP est 5/h.)
    await prisma().sessions.updateMany({ where: { user_id: b.userId }, data: { last_used_at: new Date(Date.now() - 40 * DAY) } })
    const e = await registerUser('e@example.cm')
    await prisma().users.update({ where: { id: e.userId }, data: { account_status: 'deleted', deleted_at: new Date() } })
    // premium payé ce mois pour A
    const subA = await prisma().subscriptions.findUniqueOrThrow({ where: { user_id: a.userId } })
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'x' }).expect(200)
    // tickets : un ouvert, un résolu
    await prisma().support_tickets.createMany({
      data: [
        { user_id: a.userId, user_email: 'a@example.cm', subject: 'OTP', body: 'pas reçu', status: 'open' },
        { user_id: b.userId, user_email: 'b@example.cm', subject: 'Merci', body: 'résolu', status: 'resolved' },
      ],
    })

    const r = await (await api()).get('/admin/dashboard').set(sa.auth).expect(200)
    expect(r.body.data.kpis).toEqual({
      users_total: 4, // a b c d — e est supprimé
      users_active_30d: 3, // a c d ; b dort depuis 40 jours
      premium_active: 1,
      transmissions_triggered_this_month: 2, // c et d
      transmissions_completed_this_month: 1,
      transmissions_completed_total: 1,
      checkin_rate: 50, // parmi les transmissions actives (a, b), a est à jour
      revenue_this_month_fcfa: 10000,
      tickets_open: 1,
    })
    expect(r.body.data.generated_at).toBeTypeOf('string')
    expect(Array.isArray(r.body.data.alerts)).toBe(true)
  })

  it('sans transmission active, le taux de check-in est null, pas une division par zéro', async () => {
    const sa = await loginAdmin()
    await registerUser('a@example.cm')
    const r = await (await api()).get('/admin/dashboard').set(sa.auth).expect(200)
    expect(r.body.data.kpis).toMatchObject({ users_total: 1, checkin_rate: null, premium_active: 0, tickets_open: 0 })
  })
})

describe('GET /admin/dashboard — alertes calculables', () => {
  it('rien à signaler quand tout va bien', async () => {
    const sa = await loginAdmin()
    const r = await (await api()).get('/admin/dashboard').set(sa.auth).expect(200)
    expect(r.body.data.alerts).toEqual([])
  })

  it('escrow expirant (< 12 h), pic de contacts bloqués (> 3 en 1 h), compte suspendu depuis > 24 h — triées par criticité', async () => {
    const sa = await loginAdmin()
    const a = await makeOwner('a@example.cm')
    const { transmissionId: trA } = await openTransmission(a)
    await prisma().transmissions.update({ where: { id: trA }, data: { escrow_expires_at: new Date(Date.now() + 6 * HOUR) } })
    const b = await makeOwner('b@example.cm')
    const { transmissionId: trB } = await openTransmission(b)
    // 4 contacts bloqués à l'instant
    await prisma().transmission_contacts.updateMany({ where: { transmission_id: { in: [trA, trB] } }, data: { blocked: true, status: 'failed', fail_count: 5 } })
    await prisma().trusted_contacts.updateMany({ where: { user_id: { in: [a.userId, b.userId] } }, data: { blocked_until: new Date(Date.now() + 24 * HOUR) } })
    // suspendu depuis 3 jours
    const s = await registerUser('s@example.cm')
    await prisma().users.update({ where: { id: s.userId }, data: { account_status: 'suspended', updated_at: new Date(Date.now() - 3 * DAY) } })

    const r = await (await api()).get('/admin/dashboard').set(sa.auth).expect(200)
    expect(r.body.data.alerts).toEqual([
      { type: 'escrow_expiring', severity: 'high', count: 1, transmission_ids: [trA] },
      { type: 'contact_failures_spike', severity: 'high', count: 4 },
      { type: 'accounts_suspended_stale', severity: 'medium', count: 1 },
    ])
  })
})
