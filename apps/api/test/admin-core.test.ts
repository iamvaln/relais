// @relais/admin-core contre la vraie API : session du back office (login TOTP,
// jeton 8 h, jamais de refresh, révocation), grille des rôles, BO-01 et BO-02.
// C'est ce que les écrans d'apps/web-admin appellent tels quels.

import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@relais/api-client'
import { AdminClient, AdminSession, MemorySessionStore, canAccess } from '@relais/admin-core'
import { createAdmin } from '../src/api/admin/bootstrap.js'
import { api, closeAll, getApp, registerUser, resetState } from './helpers.js'
import { makeOwner, openTransmission } from './transmission-helpers.js'
import { prisma } from '../src/lib/prisma.js'

let baseUrl = ''
beforeAll(async () => {
  baseUrl = await (await getApp()).listen({ port: 0, host: '127.0.0.1' })
})
beforeEach(resetState)
afterAll(closeAll)

const PASSWORD = 'Super-Admin-Pass-9!'
const codeFor = (secret: string) => new OTPAuth.TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).generate()

async function adminAccount(role = 'super_admin') {
  const created = await createAdmin({ email: `${role}@relais.app`, full_name: 'Valentine N.', password: PASSWORD, role })
  return { ...created, email: `${role}@relais.app`, role }
}

function device(onSessionLost?: () => void) {
  const store = new MemorySessionStore()
  const opts = onSessionLost ? { baseUrl, onSessionLost } : { baseUrl }
  const client = new AdminClient(opts)
  return { client, store, session: new AdminSession({ client, store }) }
}

describe('session du back office', () => {
  it('login email + mot de passe + TOTP → jeton 8 h gardé ; me ; logout révoque et oublie ; restore ne rend rien ensuite', async () => {
    const a = await adminAccount()
    const d = device()
    const admin = await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    expect(admin).toMatchObject({ id: a.id, email: a.email, role: 'super_admin' })
    const stored = d.store.get()!
    expect(stored.token).toBe(d.client.token)
    expect(stored.expiresAt - Date.now()).toBeGreaterThan(7.9 * 3600 * 1000)
    expect(await d.client.me()).toMatchObject({ email: a.email })

    await d.session.logout()
    expect(d.client.token).toBeNull()
    expect(d.store.get()).toBeNull()
    expect(await device().session.restore()).toBeNull()
  })

  it('mauvais TOTP → ApiError 401 AUTH_INVALID_CREDENTIALS, rien de gardé', async () => {
    const a = await adminAccount()
    const d = device()
    const err = await d.session.login({ email: a.email, password: PASSWORD, code: '000000' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'AUTH_INVALID_CREDENTIALS' })
    expect(d.store.get()).toBeNull()
    expect(d.session.admin).toBeNull()
  })

  it('jeton révoqué côté serveur (logout ailleurs) : la requête suivante ferme la session, onSessionLost est appelé, sans refresh', async () => {
    const a = await adminAccount()
    let lost = 0
    const d = device(() => lost++)
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    const other = new AdminClient({ baseUrl })
    other.token = d.client.token
    await other.logout()

    const err = await d.client.dashboard().catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 401 })
    expect(lost).toBe(1)
    expect(d.client.token).toBeNull()
    // Le store garde encore l'ancien jeton : restore le présente, l'API le refuse, tout est oublié
    expect(await d.session.restore()).toBeNull()
    expect(d.store.get()).toBeNull()
  })
})

describe('grille des rôles', () => {
  it('support : utilisateurs oui, tableau de bord non (AUTH_FORBIDDEN) — comme canAccess', async () => {
    const a = await adminAccount('support')
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    expect(canAccess('support', 'users')).toBe(true)
    expect((await d.client.users.list()).total).toBe(0)
    expect(canAccess('support', 'dashboard')).toBe(false)
    const err = await d.client.dashboard().catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
    expect(d.client.token).not.toBeNull() // un 403 n'est pas une perte de session
  })
})

describe('BO-01 tableau de bord', () => {
  it('KPIs, alertes et santé des services', async () => {
    await registerUser('adjoua@example.cm')
    const a = await adminAccount()
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    const dash = await d.client.dashboard()
    expect(dash.kpis.users_total).toBe(1)
    expect(dash.kpis.tickets_open).toBe(0)
    expect(Array.isArray(dash.alerts)).toBe(true)
    const health = await d.client.health()
    expect(health.services.postgres).toBe('ok')
    expect(health.services.redis).toBe('ok')
  })
})

describe('BO-02 utilisateurs', () => {
  it('liste filtrée et paginée, fiche, débloquer, suspendre, changer l’email, supprimer (RGPD)', async () => {
    const adjoua = await registerUser('adjoua@example.cm', { name: 'Adjoua Ngo' })
    await registerUser('herve@example.cm', { name: 'Hervé Kamga' })
    await registerUser('paul@example.cm', { name: 'Paul Biya' })
    const a = await adminAccount()
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })

    const all = await d.client.users.list()
    expect(all.total).toBe(3)
    expect(all.items.map((u) => u.email).sort()).toEqual(['adjoua@example.cm', 'herve@example.cm', 'paul@example.cm'])

    const found = await d.client.users.list({ search: 'adjoua' })
    expect(found.items.map((u) => u.email)).toEqual(['adjoua@example.cm'])
    expect((await d.client.users.list({ plan: 'premium' })).total).toBe(0)
    const page1 = await d.client.users.list({ limit: 2, page: 1 })
    const page2 = await d.client.users.list({ limit: 2, page: 2 })
    expect([page1.items.length, page2.items.length, page2.page]).toEqual([2, 1, 2])

    const detail = await d.client.users.get(adjoua.userId)
    expect(detail).toMatchObject({ email: 'adjoua@example.cm', account_status: 'active', totp_enabled: false })

    expect((await d.client.users.unblock(adjoua.userId, 'demande support')).login_fail_count).toBe(0)
    expect((await d.client.users.suspend(adjoua.userId, 'activité suspecte')).account_status).toBe('suspended')
    expect((await d.client.users.changeEmail(adjoua.userId, 'adjoua.ngo@example.cm', 'identité vérifiée')).email).toBe('adjoua.ngo@example.cm')
    expect(await d.client.users.remove(adjoua.userId, 'demande RGPD')).toEqual({ deleted: true })
    const twice = await d.client.users.remove(adjoua.userId, 'encore').catch((e: unknown) => e)
    expect(twice).toMatchObject({ status: 409, code: 'USER_ALREADY_DELETED' })
  })

  it('un support ne peut ni suspendre ni supprimer (403), mais peut débloquer', async () => {
    const u = await registerUser('adjoua@example.cm')
    const a = await adminAccount('support')
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    expect((await d.client.users.unblock(u.userId, 'x')).id).toBe(u.userId)
    expect(await d.client.users.suspend(u.userId, 'x').catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
    expect(await d.client.users.remove(u.userId, 'x').catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
  })
})

// --- Lot 2 : BO-03, BO-04, BO-05 ------------------------------------------------------

describe('BO-03 transmissions', () => {
  it('liste filtrée, détail sans identité, étendre l’escrow, relancer, débloquer un contact, annuler', async () => {
    const o = await makeOwner()
    const { transmissionId, tokens } = await openTransmission(o)
    for (let i = 0; i < 5; i++) await (await api()).post(`/relay/${tokens.contact2}/verify`).send({ failed: true })
    const a = await adminAccount()
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })

    const list = await d.client.transmissions.list()
    expect(list.total).toBe(1)
    expect(list.items[0]).toMatchObject({ id: transmissionId, status: 'triggered', schema: { n: 2, m: 2 }, contacts_notified: 2, escrow_active: true })
    expect((await d.client.transmissions.list({ status: 'completed' })).items).toEqual([])

    const detail = await d.client.transmissions.get(transmissionId)
    expect(detail.user_id).toBe(o.userId)
    expect(detail.contacts).toHaveLength(2)
    const blocked = detail.contacts.find((c) => c.blocked)!
    expect(blocked).toMatchObject({ status: 'failed', fail_count: 5 })
    expect(JSON.stringify(detail)).not.toContain('example.cm')

    const extended = await d.client.transmissions.extendEscrow(transmissionId, 24, 'délai demandé par la famille')
    expect(extended.escrow_extended_count).toBe(1)
    expect(new Date(extended.escrow_expires_at).getTime() - new Date(detail.escrow_expires_at).getTime()).toBe(24 * 3600 * 1000)
    expect(await d.client.transmissions.notify(transmissionId, 'relance')).toEqual({ notified: 1 })
    expect(await d.client.transmissions.unblockContact(transmissionId, blocked.id, 'appel du contact')).toMatchObject({ id: blocked.id, blocked: false, fail_count: 0, status: 'notified' })

    const cancelled = await d.client.transmissions.cancel(transmissionId, 'owner vivant, joint par téléphone')
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellation_reason: 'owner vivant, joint par téléphone', escrow_active: false })
    expect(cancelled.audit.map((l) => l.action).sort()).toEqual(['CONTACT_UNBLOCK', 'ESCROW_EXTEND', 'TRANSMISSION_CANCEL', 'TRANSMISSION_NOTIFY'])
    const again = await d.client.transmissions.notify(transmissionId, 'x').catch((e: unknown) => e)
    expect(again).toMatchObject({ status: 409, code: 'TRANSMISSION_ALREADY_ACTIVE' })
  })

  it('support : débloque un contact, mais ni extension ni annulation (403)', async () => {
    const o = await makeOwner()
    const { transmissionId } = await openTransmission(o)
    const a = await adminAccount('support')
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    const detail = await d.client.transmissions.get(transmissionId)
    expect(await d.client.transmissions.unblockContact(transmissionId, detail.contacts[0]!.id, 'x')).toMatchObject({ blocked: false })
    expect(await d.client.transmissions.extendEscrow(transmissionId, 24, 'x').catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
    expect(await d.client.transmissions.cancel(transmissionId, 'x').catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
  })
})

// La bibliothèque survit à resetState : un libellé distinct de celui d'admin.test.ts.
const QUESTION = {
  text_fr: 'Quel était le nom de votre premier instituteur ?',
  text_en: 'What was the name of your first teacher?',
  category: 'childhood',
  usage_type: 'secret_question',
  reliability_score: 9,
  risk_notes: 'Stable, privé, non public.',
} as const

describe('BO-04 questions', () => {
  it('bibliothèque filtrable, ajout, doublon refusé, modification, archivage', async () => {
    const a = await adminAccount('admin')
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })

    const secret = await d.client.questions.list({ usage_type: 'secret_question', status: 'active' })
    expect(secret.length).toBeGreaterThanOrEqual(31)
    expect(secret.every((q) => q.usage_type === 'secret_question' && q.status === 'active')).toBe(true)

    const created = await d.client.questions.create(QUESTION)
    expect(created).toMatchObject({ ...QUESTION, status: 'active', usage_count: 0 })
    const dup = await d.client.questions.create({ ...QUESTION, text_en: 'Other wording' }).catch((e: unknown) => e)
    expect(dup).toMatchObject({ status: 409, code: 'QUESTION_DUPLICATE' })

    const updated = await d.client.questions.update(created.id, { reliability_score: 4, status: 'review' })
    expect(updated).toMatchObject({ id: created.id, reliability_score: 4, status: 'review' })
    const archived = await d.client.questions.archive(created.id, 'score trop bas')
    expect(archived.status).toBe('archived')
    expect((await d.client.questions.list({ status: 'archived' })).map((q) => q.id)).toContain(created.id) // d'autres tests archivent aussi
    expect(await prisma().audit_logs.count({ where: { target_id: created.id, action: { in: ['QUESTION_ADD', 'QUESTION_UPDATE', 'QUESTION_ARCHIVE'] } } })).toBe(3)
  })
})

describe('BO-05 configuration', () => {
  it('super_admin : lecture typée, modification avec motif, valeur mal typée refusée ; admin : 403', async () => {
    const sa = await adminAccount()
    const d = device()
    await d.session.login({ email: sa.email, password: PASSWORD, code: codeFor(sa.totp_secret) })
    const all = await d.client.config.list()
    expect(all.find((c) => c.key === 'vault.question_min_score')).toMatchObject({ value: 6, config_type: 'int', category: 'vault', updated_by: null })
    expect(all.find((c) => c.key === 'dms.relance_intervals_days')?.value).toEqual([7, 14, 21])

    try {
      const updated = await d.client.config.update('vault.question_min_score', 10, 'durcissement')
      expect(updated).toMatchObject({ key: 'vault.question_min_score', value: 10, updated_by: sa.id })
      const bad = await d.client.config.update('vault.question_min_score', 'sept', 'x').catch((e: unknown) => e)
      expect(bad).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
      const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'CONFIG_UPDATE' } })
      expect(log).toMatchObject({ target_id: 'vault.question_min_score', reason: 'durcissement' })
    } finally {
      await prisma().app_config.update({ where: { key: 'vault.question_min_score' }, data: { value: '6', updated_by: null } })
    }

    const admin = await adminAccount('admin')
    const d2 = device()
    await d2.session.login({ email: admin.email, password: PASSWORD, code: codeFor(admin.totp_secret) })
    expect(await d2.client.config.list().catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
  })
})

// --- Lot 3 : BO-07 facturation, BO-02 tickets, BO-06 monitoring ---------------------------

describe('BO-07 facturation', () => {
  it('finance : vue d’ensemble, abonnements avec recherche, passage premium, extension, rétrogradation, export CSV ; support refusé', async () => {
    const adjoua = await registerUser('adjoua@example.cm', { name: 'Adjoua Ngo' })
    await registerUser('herve@example.cm', { name: 'Hervé Kamga' })
    const a = await adminAccount('finance')
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })

    const before = await d.client.billing.overview()
    expect(before).toMatchObject({ price_fcfa: 10000, active_premium: 0, revenue_total_fcfa: 0 })

    const all = await d.client.billing.subscriptions()
    expect(all.total).toBe(2)
    const found = await d.client.billing.subscriptions({ search: 'adjoua' })
    expect(found.items).toHaveLength(1)
    const sub = found.items[0]!
    expect(sub).toMatchObject({ user_id: adjoua.userId, user_email: 'adjoua@example.cm', full_name: 'Adjoua Ngo', plan: 'free', status: 'active' })

    const premium = await d.client.billing.changePlan(sub.id, { plan: 'premium', provider_ref: 'MOMO-42', reason: 'paiement Mobile Money reçu' })
    expect(premium).toMatchObject({ id: sub.id, plan: 'premium', status: 'active', price_fcfa: 10000 })
    expect(premium.expires_at).not.toBeNull()
    const extended = await d.client.billing.extend(sub.id, 30, 'geste commercial')
    expect(new Date(extended.expires_at!).getTime() - new Date(premium.expires_at!).getTime()).toBe(30 * 24 * 3600 * 1000)
    expect(extended.extended_count).toBe(1)
    expect((await d.client.billing.overview()).active_premium).toBe(1)
    expect((await d.client.billing.subscriptions({ plan: 'premium' })).items.map((s) => s.id)).toEqual([sub.id])

    const today = new Date().toISOString().slice(0, 10)
    const csv = await d.client.billing.exportCsv(today, today)
    expect(csv.filename).toBe(`relais-billing-${today}_${today}.csv`)
    const lines = csv.csv.trim().split('\n')
    expect(lines[0]).toBe('created_at,event_type,user_id,subscription_id,amount_fcfa,currency,provider_ref,notes')
    expect(lines).toHaveLength(3) // created + admin_extended
    expect(csv.csv).not.toContain('example.cm')
    const bad = await d.client.billing.exportCsv('2026-02-01', '2026-01-01').catch((e: unknown) => e)
    expect(bad).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })

    const free = await d.client.billing.changePlan(sub.id, { plan: 'free', reason: 'remboursé' })
    expect(free).toMatchObject({ plan: 'free', expires_at: null })

    const support = await adminAccount('support')
    const d2 = device()
    await d2.session.login({ email: support.email, password: PASSWORD, code: codeFor(support.totp_secret) })
    expect(await d2.client.billing.overview().catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
    expect(await d2.client.billing.exportCsv(today, today).catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
  })

  it('export CSV : un jeton révoqué ferme la session comme les autres appels', async () => {
    const a = await adminAccount('finance')
    let lost = 0
    const d = device(() => lost++)
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    const other = new AdminClient({ baseUrl })
    other.token = d.client.token
    await other.logout()
    const err = await d.client.billing.exportCsv('2026-01-01', '2026-01-31').catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 401 })
    expect(lost).toBe(1)
    expect(d.client.token).toBeNull()
  })
})

const TICKET = { email: 'adjoua@example.cm', subject: 'Compte bloqué', body: 'Je n’arrive plus à me connecter depuis hier.', category: 'account_locked' }

describe('BO-02 tickets', () => {
  it('support : file filtrable, détail, prise en charge à soi-même, priorité, résolution avec note ; finance refusé', async () => {
    const u = await registerUser('adjoua@example.cm')
    const t1 = (await (await api()).post('/support/tickets').send(TICKET).expect(201)).body.data as { id: string }
    const t2 = (await (await api()).post('/support/tickets').send({ ...TICKET, email: 'x@example.cm', subject: 'OTP', category: 'otp_issue' }).expect(201)).body.data as { id: string }
    const a = await adminAccount('support')
    const d = device()
    const me = await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })

    const all = await d.client.tickets.list()
    expect(all.total).toBe(2)
    expect((await d.client.tickets.list({ category: 'otp_issue' })).items.map((t) => t.id)).toEqual([t2.id])
    const one = await d.client.tickets.get(t1.id)
    expect(one).toMatchObject({ id: t1.id, user_id: u.userId, user_email: 'adjoua@example.cm', status: 'open', priority: 'normal', assigned_to: null })

    const taken = await d.client.tickets.take(t1.id, me.id)
    expect(taken).toMatchObject({ status: 'in_progress', assigned_to: me.id })
    // Assigner à un collègue (12/09/2026) : la liste des admins, sans email
    const colleague = await adminAccount('admin')
    const admins = await d.client.admins()
    expect(admins.map((x) => x.id)).toEqual(expect.arrayContaining([me.id, colleague.id]))
    expect(admins[0]).not.toHaveProperty('email')
    expect((await d.client.tickets.update(t1.id, { assigned_to: colleague.id })).assigned_to).toBe(colleague.id)
    expect((await d.client.tickets.update(t1.id, { priority: 'high' })).priority).toBe('high')
    const done = await d.client.tickets.update(t1.id, { status: 'resolved', resolution_note: 'Compte débloqué, email envoyé.' })
    expect(done.status).toBe('resolved')
    expect(done.resolved_at).not.toBeNull()
    expect((await d.client.tickets.list({ status: 'open' })).items.map((t) => t.id)).toEqual([t2.id])

    const finance = await adminAccount('finance')
    const d2 = device()
    await d2.session.login({ email: finance.email, password: PASSWORD, code: codeFor(finance.totp_secret) })
    expect(await d2.client.tickets.list().catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
  })
})

describe('BO-06 monitoring', () => {
  it('admin : santé détaillée (jobs, compteurs) et journal d’audit filtrable ; support refusé', async () => {
    const u = await registerUser('adjoua@example.cm')
    const a = await adminAccount('admin')
    const d = device()
    await d.session.login({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) })
    await d.client.users.unblock(u.userId, 'r')

    const health = await d.client.health()
    expect(health).toMatchObject({ services: { postgres: 'ok', redis: 'ok' }, jobs: { enabled: false }, counts: { users: 1, transmissions_open: 0, escrows_active: 0 } })

    const logs = await d.client.audit({ action: 'ACCOUNT_UNBLOCK' })
    expect(logs.total).toBe(1)
    expect(logs.items[0]).toMatchObject({ action: 'ACCOUNT_UNBLOCK', admin_id: a.id, target_type: 'user', target_id: u.userId, reason: 'r' })
    expect(logs.items[0]!.ip_hash).toHaveLength(64)
    expect((await d.client.audit({ admin_id: a.id })).total).toBe(2) // login + unblock
    expect((await d.client.audit({ target_id: u.userId, limit: 10 })).limit).toBe(10)

    const support = await adminAccount('support')
    const d2 = device()
    await d2.session.login({ email: support.email, password: PASSWORD, code: codeFor(support.totp_secret) })
    expect(await d2.client.audit().catch((e: unknown) => e)).toMatchObject({ status: 403, code: 'AUTH_FORBIDDEN' })
  })
})
