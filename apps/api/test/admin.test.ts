// Back office (Backend Specs §3.8, Back Office Specs v1.0).

import * as OTPAuth from 'otpauth'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdmin } from '../src/api/admin/bootstrap.js'
import { prisma } from '../src/lib/prisma.js'
import { api, closeAll, registerUser, resetState } from './helpers.js'

beforeEach(resetState)
afterAll(closeAll)

const PASSWORD = 'Super-Admin-Pass-9!'

function codeFor(secret: string): string {
  return new OTPAuth.TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).generate()
}

/** Un admin créé par le script, prêt à se connecter. */
async function admin(role = 'super_admin', email = 'valentine@relais.app') {
  const created = await createAdmin({ email, full_name: 'Valentine N.', password: PASSWORD, role })
  return { ...created, email, role }
}

async function login(email: string, secret: string, password = PASSWORD) {
  const r = await (await api()).post('/admin/auth/login').send({ email, password, code: codeFor(secret) }).expect(200)
  return { token: r.body.data.access_token as string, auth: { Authorization: `Bearer ${r.body.data.access_token as string}` } }
}

describe('bootstrap — createAdmin (script CLI)', () => {
  it('crée un admin avec mot de passe Argon2id, TOTP activé, et le journalise dans audit_logs', async () => {
    const a = await admin()
    expect(a.id).toBeTypeOf('string')
    expect(a.totp_secret).toMatch(/^[A-Z2-7]{16,}$/)
    expect(a.otpauth_uri).toContain('otpauth://totp/')
    expect(a.otpauth_uri).toContain(encodeURIComponent('valentine@relais.app'))
    const row = await prisma().admin_users.findUniqueOrThrow({ where: { id: a.id } })
    expect(row).toMatchObject({ role: 'super_admin', status: 'active', totp_enabled: true, totp_secret: a.totp_secret })
    expect(row.password_hash).toMatch(/^\$argon2id\$/)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'ADMIN_CREATED' } })
    expect(log).toMatchObject({ target_type: 'admin', target_id: a.id, admin_id: null })
  })

  it('refuse un mot de passe faible, un rôle inconnu, un email déjà pris', async () => {
    await expect(createAdmin({ email: 'x@relais.app', full_name: 'X', password: 'court', role: 'admin' })).rejects.toThrow(/mot de passe/i)
    await expect(createAdmin({ email: 'x@relais.app', full_name: 'X', password: PASSWORD, role: 'god' })).rejects.toThrow(/rôle/i)
    await admin('admin', 'x@relais.app')
    await expect(createAdmin({ email: 'x@relais.app', full_name: 'X', password: PASSWORD, role: 'admin' })).rejects.toThrow(/existe/i)
  })
})

describe('POST /admin/auth/login', () => {
  it('email + mot de passe + TOTP → token admin ; ADMIN_LOGIN audité ; last_login_at posé', async () => {
    const a = await admin()
    const before = Date.now()
    const r = await (await api()).post('/admin/auth/login').send({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) }).expect(200)
    expect(r.body.data.admin).toEqual({ id: a.id, email: a.email, full_name: 'Valentine N.', role: 'super_admin' })
    expect(r.body.data.access_token).toBeTypeOf('string')
    expect(r.body.data.expires_in).toBe(8 * 3600)
    const row = await prisma().admin_users.findUniqueOrThrow({ where: { id: a.id } })
    expect(row.last_login_at!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'ADMIN_LOGIN' } })
    expect(log).toMatchObject({ admin_id: a.id })
    expect(log.ip_hash).toHaveLength(64)
  })

  it('mauvais mot de passe → 401 ; code TOTP absent ou faux → 401, sans révéler lequel', async () => {
    const a = await admin()
    const bad = await (await api()).post('/admin/auth/login').send({ email: a.email, password: 'Wrong-Pass-9!', code: codeFor(a.totp_secret) }).expect(401)
    expect(bad.body.error.code).toBe('AUTH_INVALID_CREDENTIALS')
    const noCode = await (await api()).post('/admin/auth/login').send({ email: a.email, password: PASSWORD }).expect(400)
    expect(noCode.body.error.code).toBe('VALIDATION_ERROR')
    const wrongCode = await (await api()).post('/admin/auth/login').send({ email: a.email, password: PASSWORD, code: '000000' }).expect(401)
    expect(wrongCode.body.error.code).toBe('AUTH_INVALID_CREDENTIALS')
    expect((await prisma().admin_users.findUniqueOrThrow({ where: { id: a.id } })).login_fail_count).toBe(2)
    expect(await prisma().audit_logs.count({ where: { action: 'ADMIN_LOGIN' } })).toBe(0)
  })

  it('compte verrouillé ou suspendu → refusé même avec les bons secrets', async () => {
    const a = await admin()
    await prisma().admin_users.update({ where: { id: a.id }, data: { login_fail_count: 5, login_locked_until: new Date(Date.now() + 15 * 60 * 1000) } })
    const locked = await (await api()).post('/admin/auth/login').send({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) }).expect(423)
    expect(locked.body.error.code).toBe('AUTH_ACCOUNT_LOCKED')
    await prisma().admin_users.update({ where: { id: a.id }, data: { login_fail_count: 0, login_locked_until: null, status: 'suspended' } })
    const suspended = await (await api()).post('/admin/auth/login').send({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) }).expect(403)
    expect(suspended.body.error.code).toBe('AUTH_ACCOUNT_SUSPENDED')
  })

  it('est limité à 5 tentatives par 15 min et par IP (§7.1)', async () => {
    const a = await admin()
    for (let i = 0; i < 5; i++) await (await api()).post('/admin/auth/login').send({ email: a.email, password: 'Wrong-Pass-9!', code: '000000' })
    const r = await (await api()).post('/admin/auth/login').send({ email: a.email, password: PASSWORD, code: codeFor(a.totp_secret) }).expect(429)
    expect(r.body.error.code).toBe('RATE_LIMITED')
  })
})

describe('session admin', () => {
  it('le token admin ouvre /admin/me ; un token utilisateur est refusé ; logout révoque immédiatement', async () => {
    const a = await admin()
    const { auth } = await login(a.email, a.totp_secret)
    const me = await (await api()).get('/admin/me').set(auth).expect(200)
    expect(me.body.data).toMatchObject({ id: a.id, role: 'super_admin' })

    const u = await registerUser('adjoua@example.cm')
    const asUser = await (await api()).get('/admin/me').set('Authorization', `Bearer ${u.accessToken}`).expect(401)
    expect(asUser.body.error.code).toBe('AUTH_TOKEN_INVALID')
    await (await api()).get('/auth/me').set(auth).expect(401)

    await (await api()).post('/admin/auth/logout').set(auth).expect(200)
    await (await api()).get('/admin/me').set(auth).expect(401)
  })
})
