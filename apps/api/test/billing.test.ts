// Facturation (Back Office BO-07, Backend §3.8) — encaissement manuel en V1.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { expireSubscriptions } from '../src/jobs/billing.js'
import { prisma } from '../src/lib/prisma.js'
import { loginAdmin } from './admin-helpers.js'
import { api, closeAll, lastEmailTo, mailbox, registerUser, resetState } from './helpers.js'

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
  it('liste paginée, filtrable par plan et statut ; identité de l’abonné (BO lot 3) et recherche par nom, email, téléphone', async () => {
    const a = await registerUser('adjoua@example.cm', { name: 'Adjoua Ngo' })
    await registerUser('herve@example.cm', { name: 'Hervé Kamga' })
    const sa = await loginAdmin()
    const subA = await subscriptionOf(a.userId)
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'x' }).expect(200)
    const all = await (await api()).get('/admin/billing/subscriptions').set(sa.auth).expect(200)
    expect(all.body.data.total).toBe(2)
    const premium = await (await api()).get('/admin/billing/subscriptions?plan=premium').set(sa.auth).expect(200)
    expect(premium.body.data.items.map((s: { user_id: string }) => s.user_id)).toEqual([a.userId])
    expect(premium.body.data.items[0]).toMatchObject({ id: subA.id, plan: 'premium', status: 'active', price_fcfa: 10000, user_email: 'adjoua@example.cm', full_name: 'Adjoua Ngo' })

    // La finance n'a pas le module Utilisateurs : elle retrouve l'abonné ici (décision du 12/09/2026).
    const byName = await (await api()).get('/admin/billing/subscriptions?search=kamga').set(sa.auth).expect(200)
    expect(byName.body.data.items.map((s: { user_email: string }) => s.user_email)).toEqual(['herve@example.cm'])
    const byEmail = await (await api()).get('/admin/billing/subscriptions?search=ADJOUA@').set(sa.auth).expect(200)
    expect(byEmail.body.data.total).toBe(1)
    expect((await (await api()).get('/admin/billing/subscriptions?search=personne').set(sa.auth).expect(200)).body.data.items).toEqual([])
  })
})

// --- Job billing:expire — grâce puis rétrogradation ------------------------------------

async function premiumUser(email: string, expiresAt: Date) {
  const u = await registerUser(email)
  const sub = await subscriptionOf(u.userId)
  await prisma().subscriptions.update({ where: { id: sub.id }, data: { plan: 'premium', status: 'active', expires_at: expiresAt, price_fcfa: 10000 } })
  await prisma().users.update({ where: { id: u.userId }, data: { plan: 'premium' } })
  mailbox.clear()
  return { ...u, subId: sub.id }
}

describe('expireSubscriptions', () => {
  it('ne touche pas un premium encore valide', async () => {
    const now = new Date('2026-09-11T09:45:00Z')
    await premiumUser('adjoua@example.cm', new Date(now.getTime() + 30 * DAY))
    expect(await expireSubscriptions(now)).toEqual({ graced: 0, expired: 0 })
    expect(mailbox.sent).toHaveLength(0)
  })

  it('échéance dépassée : grâce (premium conservé), grace_until = échéance + billing.grace_period_days, événement et email — une seule fois', async () => {
    const now = new Date('2026-09-11T09:45:00Z')
    const expiresAt = new Date(now.getTime() - 2 * DAY)
    const u = await premiumUser('adjoua@example.cm', expiresAt)
    expect(await expireSubscriptions(now)).toEqual({ graced: 1, expired: 0 })

    const sub = await subscriptionOf(u.userId)
    expect(sub).toMatchObject({ plan: 'premium', status: 'grace' })
    expect(sub.grace_until!.getTime()).toBe(expiresAt.getTime() + 7 * DAY)
    expect((await prisma().users.findUniqueOrThrow({ where: { id: u.userId } })).plan).toBe('premium')
    const ev = await prisma().payment_events.findFirstOrThrow({ where: { user_id: u.userId } })
    expect(ev).toMatchObject({ event_type: 'grace_started', amount_fcfa: null })
    const mail = lastEmailTo('adjoua@example.cm')
    expect(mail?.subject).toMatch(/expire bientôt/)
    expect(mail?.text).toContain(sub.grace_until!.toISOString().slice(0, 10))

    expect(await expireSubscriptions(new Date(now.getTime() + DAY))).toEqual({ graced: 0, expired: 0 })
    expect(await prisma().payment_events.count({ where: { user_id: u.userId } })).toBe(1)
  })

  it('grâce écoulée : expiré, plan gratuit des deux côtés, événement expired, email ; idempotent', async () => {
    const now = new Date('2026-09-11T09:45:00Z')
    const u = await premiumUser('adjoua@example.cm', new Date(now.getTime() - 20 * DAY))
    await prisma().subscriptions.update({ where: { id: u.subId }, data: { status: 'grace', grace_until: new Date(now.getTime() - DAY) } })
    expect(await expireSubscriptions(now)).toEqual({ graced: 0, expired: 1 })

    const sub = await subscriptionOf(u.userId)
    expect(sub).toMatchObject({ plan: 'free', status: 'expired' })
    expect((await prisma().users.findUniqueOrThrow({ where: { id: u.userId } })).plan).toBe('free')
    expect((await prisma().payment_events.findFirstOrThrow({ where: { user_id: u.userId } })).event_type).toBe('expired')
    expect(lastEmailTo('adjoua@example.cm')?.subject).toMatch(/a expiré/)
    expect(await expireSubscriptions(now)).toEqual({ graced: 0, expired: 0 })
    // un renouvellement après expiration repart d'aujourd'hui et compte comme 'created'
    const sa = await loginAdmin()
    const r = await (await api()).put(`/admin/billing/${u.subId}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'revenu' }).expect(200)
    expect(r.body.data.status).toBe('active')
    expect((await prisma().payment_events.findFirstOrThrow({ where: { user_id: u.userId }, orderBy: { created_at: 'desc' } })).event_type).toBe('created')
  })

  it('lit billing.grace_period_days dans app_config', async () => {
    const now = new Date('2026-09-11T09:45:00Z')
    const expiresAt = new Date(now.getTime() - DAY)
    const u = await premiumUser('adjoua@example.cm', expiresAt)
    await prisma().app_config.update({ where: { key: 'billing.grace_period_days' }, data: { value: '3' } })
    try {
      await expireSubscriptions(now)
      expect((await subscriptionOf(u.userId)).grace_until!.getTime()).toBe(expiresAt.getTime() + 3 * DAY)
    } finally {
      await prisma().app_config.update({ where: { key: 'billing.grace_period_days' }, data: { value: '7' } })
    }
  })
})

// --- Vue d'ensemble et export (BO-07) ----------------------------------------------

describe('GET /admin/billing/overview', () => {
  it('KPIs : premium actifs, MRR/ARR, renouvellements, churns, grâce, revenus du mois et cumulés', async () => {
    const sa = await loginAdmin()
    const a = await registerUser('a@example.cm')
    const b = await registerUser('b@example.cm')
    const c = await registerUser('c@example.cm')
    await registerUser('d@example.cm') // reste gratuit
    const subA = await subscriptionOf(a.userId)
    const subB = await subscriptionOf(b.userId)
    const subC = await subscriptionOf(c.userId)
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'x' }).expect(200)
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'premium', amount_fcfa: 9000, reason: 'renouvelé' }).expect(200)
    await (await api()).put(`/admin/billing/${subB.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'x' }).expect(200)
    await (await api()).put(`/admin/billing/${subC.id}/plan`).set(sa.auth).send({ plan: 'premium', reason: 'x' }).expect(200)
    // C passe en grâce ; un churn du mois est enregistré à la main sur D
    await prisma().subscriptions.update({ where: { id: subC.id }, data: { status: 'grace', grace_until: new Date(Date.now() + 5 * DAY) } })
    const d = await prisma().users.findUniqueOrThrow({ where: { email: 'd@example.cm' } })
    const subD = await subscriptionOf(d.id)
    await prisma().payment_events.create({ data: { user_id: d.id, subscription_id: subD.id, event_type: 'expired' } })

    const support = await loginAdmin('support')
    await (await api()).get('/admin/billing/overview').set(support.auth).expect(403)

    const r = await (await api()).get('/admin/billing/overview').set(sa.auth).expect(200)
    expect(r.body.data).toEqual({
      price_fcfa: 10000,
      active_premium: 3, // A, B et C (en grâce, premium conservé)
      in_grace: 1,
      mrr_fcfa: 2500, // 3 × 10000 / 12, arrondi
      arr_fcfa: 30000,
      renewals_this_month: 1,
      churns_this_month: 1,
      revenue_this_month_fcfa: 39000, // 10000 + 9000 + 10000 + 10000
      revenue_total_fcfa: 39000,
    })
  })
})

describe('GET /admin/billing/export', () => {
  it('CSV des événements de paiement sur une période, en pièce jointe, sans email', async () => {
    const sa = await loginAdmin()
    const a = await registerUser('a@example.cm')
    const subA = await subscriptionOf(a.userId)
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'premium', provider_ref: 'MOMO-42', reason: 'x' }).expect(200)
    const today = new Date().toISOString().slice(0, 10)

    const r = await (await api()).get(`/admin/billing/export?from=${today}&to=${today}`).set(sa.auth).expect(200)
    expect(r.headers['content-type']).toMatch(/^text\/csv/)
    expect(r.headers['content-disposition']).toBe(`attachment; filename="relais-billing-${today}_${today}.csv"`)
    const lines = r.text.trim().split('\n')
    expect(lines[0]).toBe('created_at,event_type,user_id,subscription_id,amount_fcfa,currency,provider_ref,notes')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(`created,${a.userId},${subA.id},10000,XAF,MOMO-42,x`)
    expect(r.text).not.toContain('example.cm')

    const empty = await (await api()).get('/admin/billing/export?from=2026-01-01&to=2026-01-31').set(sa.auth).expect(200)
    expect(empty.text.trim().split('\n')).toHaveLength(1)
    await (await api()).get('/admin/billing/export?from=2026-02-01&to=2026-01-01').set(sa.auth).expect(400)
  })

  it('audit LOW-11 : une cellule texte qui commence par = + - @ est neutralisée (apostrophe), \\r est cité ; les montants restent bruts', async () => {
    const sa = await loginAdmin()
    const a = await registerUser('a@example.cm')
    const subA = await subscriptionOf(a.userId)
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'premium', provider_ref: '@SUM(1)', reason: '=HYPERLINK("http://evil")' }).expect(200)
    await (await api()).put(`/admin/billing/${subA.id}/plan`).set(sa.auth).send({ plan: 'free', reason: 'ligne\rsuivante' }).expect(200)
    const today = new Date().toISOString().slice(0, 10)
    const r = await (await api()).get(`/admin/billing/export?from=${today}&to=${today}`).set(sa.auth).expect(200)
    const lines = r.text.split('\n')
    expect(lines[1]).toContain(`,10000,XAF,'@SUM(1),"'=HYPERLINK(""http://evil"")"`)
    expect(lines[2]).toContain(',"ligne\rsuivante"')
    expect(r.text).not.toMatch(/,=HYPERLINK/)
  })
})
