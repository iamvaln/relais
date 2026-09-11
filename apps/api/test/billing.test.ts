// Facturation (Back Office BO-07, Backend §3.8) — encaissement manuel en V1.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { loginAdmin } from './admin-helpers.js'
import { api, closeAll, registerUser, resetState } from './helpers.js'

const DAY = 24 * 3600 * 1000

beforeEach(resetState)
afterAll(closeAll)

async function subscriptionOf(userId: string) {
  return prisma().subscriptions.findUniqueOrThrow({ where: { user_id: userId } })
}

describe('PUT /admin/billing/:id/plan', () => {
  it('finance ou super_admin ; support refusé', async () => {
    const u = await registerUser('adjoua@example.cm')
    const sub = await subscriptionOf(u.userId)
    const support = await loginAdmin('support')
    await (await api()).put(`/admin/billing/${sub.id}/plan`).set(support.auth).send({ plan: 'premium', reason: 'x' }).expect(403)
    const finance = await loginAdmin('finance')
    await (await api()).put(`/admin/billing/${sub.id}/plan`).set(finance.auth).send({ plan: 'premium', amount_fcfa: 10000, provider_ref: 'MOMO-123', reason: 'paiement reçu' }).expect(200)
  })

  it('passage en premium : 12 mois, prix du catalogue, événement created, users.plan synchronisé, PLAN_CHANGE audité', async () => {
    const u = await registerUser('adjoua@example.cm')
    const sub = await subscriptionOf(u.userId)
    const sa = await loginAdmin()
    const before = Date.now()
    const r = await (await api()).put(`/admin/billing/${sub.id}/plan`).set(sa.auth).send({ plan: 'premium', provider_ref: 'MOMO-123', reason: 'paiement Mobile Money reçu' }).expect(200)
    expect(r.body.data).toMatchObject({ id: sub.id, user_id: u.userId, plan: 'premium', status: 'active', price_fcfa: 10000, currency: 'XAF', grace_until: null })
    const expires = Date.parse(r.body.data.expires_at)
    expect(expires - before).toBeGreaterThan(364 * DAY)
    expect(expires - before).toBeLessThan(367 * DAY)

    expect((await prisma().users.findUniqueOrThrow({ where: { id: u.userId } })).plan).toBe('premium')
    const me = await (await api()).get('/auth/me').set('Authorization', `Bearer ${u.accessToken}`).expect(200)
    expect(me.body.data.plan).toBe('premium')

    const events = await prisma().payment_events.findMany({ where: { user_id: u.userId } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event_type: 'created', amount_fcfa: 10000, currency: 'XAF', provider_ref: 'MOMO-123', subscription_id: sub.id })
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'PLAN_CHANGE' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_type: 'subscription', target_id: sub.id, user_id: u.userId, reason: 'paiement Mobile Money reçu' })
    expect(log.value_before).toMatchObject({ plan: 'free' })
    expect(log.value_after).toMatchObject({ plan: 'premium' })
  })

  it('renouvellement : un premium encore actif gagne 12 mois de plus à partir de son échéance, événement renewed, montant explicite', async () => {
    const u = await registerUser('adjoua@example.cm')
    const sub = await subscriptionOf(u.userId)
    const sa = await loginAdmin()
    await (await api()).put(`/admin/billing/${sub.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'first' }).expect(200)
    const first = (await subscriptionOf(u.userId)).expires_at!
    const r = await (await api()).put(`/admin/billing/${sub.id}/plan`).set(sa.auth).send({ plan: 'premium', amount_fcfa: 9000, reason: 'renouvellement remisé' }).expect(200)
    const second = Date.parse(r.body.data.expires_at)
    expect(second - first.getTime()).toBeGreaterThan(364 * DAY)
    expect(second - first.getTime()).toBeLessThan(367 * DAY)
    const events = await prisma().payment_events.findMany({ where: { user_id: u.userId }, orderBy: { created_at: 'asc' } })
    expect(events.map((e) => e.event_type)).toEqual(['created', 'renewed'])
    expect(events[1]!.amount_fcfa).toBe(9000)
  })

  it('rétrogradation en gratuit : immédiate, événement admin_downgraded sans montant, users.plan free', async () => {
    const u = await registerUser('adjoua@example.cm')
    const sub = await subscriptionOf(u.userId)
    const sa = await loginAdmin()
    await (await api()).put(`/admin/billing/${sub.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'first' }).expect(200)
    const r = await (await api()).put(`/admin/billing/${sub.id}/plan`).set(sa.auth).send({ plan: 'free', reason: 'remboursé' }).expect(200)
    expect(r.body.data).toMatchObject({ plan: 'free', status: 'active', expires_at: null, grace_until: null })
    expect((await prisma().users.findUniqueOrThrow({ where: { id: u.userId } })).plan).toBe('free')
    const last = await prisma().payment_events.findFirstOrThrow({ where: { user_id: u.userId }, orderBy: { created_at: 'desc' } })
    expect(last).toMatchObject({ event_type: 'admin_downgraded', amount_fcfa: null, notes: 'remboursé' })
    // free → free n'a pas de sens
    const noop = await (await api()).put(`/admin/billing/${sub.id}/plan`).set(sa.auth).send({ plan: 'free', reason: 'encore' }).expect(400)
    expect(noop.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST /admin/billing/:id/extend', () => {
  it('geste commercial : prolonge l’échéance, compte l’extension, événement admin_extended ; un compte en grâce ou expiré redevient premium actif', async () => {
    const u = await registerUser('adjoua@example.cm')
    const sub = await subscriptionOf(u.userId)
    const sa = await loginAdmin()
    await (await api()).put(`/admin/billing/${sub.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'first' }).expect(200)
    const expires = (await subscriptionOf(u.userId)).expires_at!

    const r = await (await api()).post(`/admin/billing/${sub.id}/extend`).set(sa.auth).send({ days: 30, reason: 'bug de sync' }).expect(200)
    expect(Date.parse(r.body.data.expires_at) - expires.getTime()).toBe(30 * DAY)
    expect(r.body.data).toMatchObject({ extended_count: 1, extension_reason: 'bug de sync', last_extended_by: sa.id })
    const ev = await prisma().payment_events.findFirstOrThrow({ where: { user_id: u.userId, event_type: 'admin_extended' } })
    expect(ev).toMatchObject({ amount_fcfa: null, notes: 'bug de sync' })
    expect(await prisma().audit_logs.count({ where: { action: 'SUBSCRIPTION_EXTEND', target_id: sub.id } })).toBe(1)

    // expiré depuis 10 jours : l'extension repart d'aujourd'hui, pas de l'ancienne échéance
    await prisma().subscriptions.update({ where: { id: sub.id }, data: { plan: 'free', status: 'expired', expires_at: new Date(Date.now() - 10 * DAY), grace_until: new Date(Date.now() - 3 * DAY) } })
    await prisma().users.update({ where: { id: u.userId }, data: { plan: 'free' } })
    const before = Date.now()
    const back = await (await api()).post(`/admin/billing/${sub.id}/extend`).set(sa.auth).send({ days: 15, reason: 'geste' }).expect(200)
    expect(back.body.data).toMatchObject({ plan: 'premium', status: 'active', grace_until: null, extended_count: 2 })
    expect(Date.parse(back.body.data.expires_at) - before).toBeGreaterThan(14.99 * DAY)
    expect((await prisma().users.findUniqueOrThrow({ where: { id: u.userId } })).plan).toBe('premium')

    await (await api()).post(`/admin/billing/${sub.id}/extend`).set(sa.auth).send({ days: 0, reason: 'x' }).expect(400)
    await (await api()).post('/admin/billing/00000000-0000-4000-8000-000000000000/extend').set(sa.auth).send({ days: 1, reason: 'x' }).expect(404)
  })
})

describe('GET /admin/billing/subscriptions', () => {
  it('liste paginée, filtrable par plan et statut', async () => {
    const a = await registerUser('a@example.cm')
    await registerUser('b@example.cm')
    const sa = await loginAdmin()
    const subA = await subscriptionOf(a.userId)
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'x' }).expect(200)
    const all = await (await api()).get('/admin/billing/subscriptions').set(sa.auth).expect(200)
    expect(all.body.data.total).toBe(2)
    const premium = await (await api()).get('/admin/billing/subscriptions?plan=premium').set(sa.auth).expect(200)
    expect(premium.body.data.items.map((s: { user_id: string }) => s.user_id)).toEqual([a.userId])
    expect(premium.body.data.items[0]).toMatchObject({ id: subA.id, plan: 'premium', status: 'active', price_fcfa: 10000 })
    expect(JSON.stringify(all.body.data)).not.toContain('example.cm')
  })
})
