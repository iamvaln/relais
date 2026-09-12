// @relais/admin-core contre la vraie API : session du back office (login TOTP,
// jeton 8 h, jamais de refresh, révocation), grille des rôles, BO-01 et BO-02.
// C'est ce que les écrans d'apps/web-admin appellent tels quels.

import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@relais/api-client'
import { AdminClient, AdminSession, MemorySessionStore, canAccess } from '@relais/admin-core'
import { createAdmin } from '../src/api/admin/bootstrap.js'
import { closeAll, getApp, registerUser, resetState } from './helpers.js'

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
