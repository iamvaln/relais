// Back office (Backend Specs §3.8, Back Office Specs v1.0).

import * as OTPAuth from 'otpauth'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdmin } from '../src/api/admin/bootstrap.js'
import { vaultKey } from '../src/api/vault/service.js'
import { prisma } from '../src/lib/prisma.js'
import { objectStore } from '../src/services/storage/index.js'
import { api, closeAll, lastEmailTo, lastOtp, mailbox, registerUser, resetState, STRONG_PASSWORD } from './helpers.js'
import { activateTransmission, makeOwner } from './transmission-helpers.js'

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

// --- BO-02 Utilisateurs -----------------------------------------------------------

async function superAdmin() {
  const a = await admin('super_admin')
  return { ...a, ...(await login(a.email, a.totp_secret)) }
}
async function adminWithRole(role: string) {
  const a = await admin(role, `${role}@relais.app`)
  return { ...a, ...(await login(a.email, a.totp_secret)) }
}

const FORBIDDEN_FIELDS = ['password_hash', 'ed25519_pk', 'totp_secret', 'notification_enc', 'secret_enc', 'content_enc']

describe('GET /admin/users', () => {
  it('liste paginée, filtrable, métadonnées seulement', async () => {
    const sa = await superAdmin()
    const a = await registerUser('adjoua@example.cm', { name: 'Adjoua Ngo' })
    await registerUser('herve@example.cm', { name: 'Hervé Kamga' })
    await prisma().users.update({ where: { id: a.userId }, data: { plan: 'premium' } })

    const all = await (await api()).get('/admin/users').set(sa.auth).expect(200)
    expect(all.body.data.total).toBe(2)
    expect(all.body.data.items).toHaveLength(2)
    expect(all.body.data.items[0]).toMatchObject({ email: expect.any(String), plan: expect.any(String), account_status: 'active', transmission_status: 'inactive' })
    for (const f of FORBIDDEN_FIELDS) expect(JSON.stringify(all.body.data)).not.toContain(`"${f}"`)

    const premium = await (await api()).get('/admin/users?plan=premium').set(sa.auth).expect(200)
    expect(premium.body.data.items.map((u: { id: string }) => u.id)).toEqual([a.userId])
    const search = await (await api()).get('/admin/users?search=kamga').set(sa.auth).expect(200)
    expect(search.body.data.items).toHaveLength(1)
    expect(search.body.data.items[0].full_name).toBe('Hervé Kamga')
    const page = await (await api()).get('/admin/users?limit=1&page=2').set(sa.auth).expect(200)
    expect(page.body.data).toMatchObject({ total: 2, page: 2, limit: 1 })
    expect(page.body.data.items).toHaveLength(1)
  })

  it('support y accède, finance non', async () => {
    const support = await adminWithRole('support')
    await (await api()).get('/admin/users').set(support.auth).expect(200)
    const finance = await adminWithRole('finance')
    const r = await (await api()).get('/admin/users').set(finance.auth).expect(403)
    expect(r.body.error.code).toBe('AUTH_STEPUP_REQUIRED')
  })
})

describe('GET /admin/users/:id', () => {
  it('fiche : compte, abonnement, transmission en chiffres, jamais de contenu ni d’identité de contact', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    await activateTransmission(o)
    const r = await (await api()).get(`/admin/users/${o.userId}`).set(sa.auth).expect(200)
    expect(r.body.data).toMatchObject({
      id: o.userId,
      email: o.email,
      account_status: 'active',
      email_verified: true,
      plan: 'free',
      subscription: { plan: 'free', status: 'active' },
      transmission: { status: 'active', contacts_count: 2, schema: { n: 2, m: 2 } },
      counts: { journal_entries: 0, checkins: 0 },
    })
    expect(r.body.data.transmission.next_checkin_due).toBeTypeOf('string')
    const text = JSON.stringify(r.body.data)
    for (const f of FORBIDDEN_FIELDS) expect(text).not.toContain(`"${f}"`)
    expect(text).not.toContain('contact1@')
    await (await api()).get('/admin/users/00000000-0000-4000-8000-000000000000').set(sa.auth).expect(404)
  })
})

describe('POST /admin/users/:id/unblock', () => {
  it('remet les compteurs à zéro, lève une suspension, prévient par email, audite ACCOUNT_UNBLOCK', async () => {
    const sa = await superAdmin()
    const u = await registerUser('adjoua@example.cm')
    await prisma().users.update({
      where: { id: u.userId },
      data: { login_fail_count: 5, login_locked_until: new Date(Date.now() + 900000), otp_fail_count: 3, account_status: 'suspended' },
    })
    mailbox.clear()
    const r = await (await api()).post(`/admin/users/${u.userId}/unblock`).set(sa.auth).send({ reason: 'ticket #12' }).expect(200)
    expect(r.body.data).toMatchObject({ account_status: 'active' })
    const row = await prisma().users.findUniqueOrThrow({ where: { id: u.userId } })
    expect(row).toMatchObject({ login_fail_count: 0, login_locked_until: null, otp_fail_count: 0, account_status: 'active' })
    expect(lastEmailTo('adjoua@example.cm')?.subject).toMatch(/débloqué/)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'ACCOUNT_UNBLOCK' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_type: 'user', target_id: u.userId, user_id: u.userId, reason: 'ticket #12' })
  })
})

describe('POST /admin/users/otp-regen', () => {
  it('renvoie un nouveau code à une inscription en attente ; l’ancien ne marche plus ; OTP_REGEN audité sans l’email', async () => {
    const sa = await superAdmin()
    await (await api()).post('/auth/register').send({ full_name: 'Adjoua Ngo', email: 'adjoua@example.cm', phone: '+237690000000', password: STRONG_PASSWORD }).expect(200)
    const first = lastOtp()
    const r = await (await api()).post('/admin/users/otp-regen').set(sa.auth).send({ email: 'adjoua@example.cm' }).expect(200)
    expect(r.body.data).toEqual({ sent: true })
    const second = lastOtp()
    expect(second).not.toBe(first)
    await (await api()).post('/auth/email/verify').send({ email: 'adjoua@example.cm', code: first }).expect(401)
    await (await api()).post('/auth/email/verify').send({ email: 'adjoua@example.cm', code: second }).expect(200)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'OTP_REGEN' } })
    expect(JSON.stringify(log)).not.toContain('adjoua@')

    const unknown = await (await api()).post('/admin/users/otp-regen').set(sa.auth).send({ email: 'nobody@example.cm' }).expect(404)
    expect(unknown.body.error.code).toBe('NOT_FOUND')
  })
})

describe('POST /admin/users/:id/suspend', () => {
  it('suspend le compte, met la transmission en pause, coupe les sessions, prévient, audite ; rôle admin requis', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    await activateTransmission(o)
    mailbox.clear()
    const support = await adminWithRole('support')
    await (await api()).post(`/admin/users/${o.userId}/suspend`).set(support.auth).send({ reason: 'activité suspecte' }).expect(403)

    const r = await (await api()).post(`/admin/users/${o.userId}/suspend`).set(sa.auth).send({ reason: 'activité suspecte' }).expect(200)
    expect(r.body.data).toMatchObject({ account_status: 'suspended', transmission_status: 'paused' })
    expect((await prisma().users.findUniqueOrThrow({ where: { id: o.userId } })).account_status).toBe('suspended')
    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.status).toBe('paused')
    expect(cfg.pause_until).not.toBeNull()
    await (await api()).get('/auth/me').set(o.auth).expect(403)
    expect(lastEmailTo(o.email)?.subject).toMatch(/suspendu/)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'ACCOUNT_SUSPEND' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_id: o.userId, reason: 'activité suspecte' })
  })
})

describe('PUT /admin/users/:id/email', () => {
  it('change l’email après vérification manuelle ; audit avant/après en hashes ; email déjà pris → 409', async () => {
    const sa = await superAdmin()
    const u = await registerUser('adjoua@example.cm')
    await registerUser('herve@example.cm')
    const r = await (await api()).put(`/admin/users/${u.userId}/email`).set(sa.auth).send({ email: 'Adjoua.New@Example.cm', reason: 'CNI vérifiée' }).expect(200)
    expect(r.body.data.email).toBe('adjoua.new@example.cm')
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'EMAIL_CHANGE' } })
    expect(JSON.stringify(log)).not.toContain('adjoua')
    expect(log.value_before).toMatchObject({ email_hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const taken = await (await api()).put(`/admin/users/${u.userId}/email`).set(sa.auth).send({ email: 'herve@example.cm', reason: 'x' }).expect(409)
    expect(taken.body.error.code).toBe('USER_EMAIL_TAKEN')
  })
})

describe('DELETE /admin/users/:id (RGPD)', () => {
  it('super_admin seulement : purge stockage et données, annule la transmission, anonymise la ligne, audite', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    const cs = await activateTransmission(o)
    await objectStore().put(vaultKey(o.userId, 'accounts'), new Uint8Array([1, 2, 3]))
    await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { status: 'triggered' } })
    const { trigger } = await import('../src/jobs/deadman.js')
    await trigger(new Date())

    const adminRole = await adminWithRole('admin')
    await (await api()).delete(`/admin/users/${o.userId}`).set(adminRole.auth).send({ reason: 'demande RGPD' }).expect(403)

    const r = await (await api()).delete(`/admin/users/${o.userId}`).set(sa.auth).send({ reason: 'demande RGPD' }).expect(200)
    expect(r.body.data).toEqual({ deleted: true })

    const row = await prisma().users.findUniqueOrThrow({ where: { id: o.userId } })
    expect(row.account_status).toBe('deleted')
    expect(row.deleted_at).not.toBeNull()
    expect(row.deleted_by_admin).toBe(sa.id)
    expect(row.deletion_reason).toBe('demande RGPD')
    expect(row.email).not.toContain('adjoua')
    expect(row.full_name).not.toContain('Adjoua')
    expect(row.phone).toBeNull()
    expect(row.ed25519_pk).toBeNull()
    expect(await prisma().trusted_contacts.count({ where: { user_id: o.userId } })).toBe(0)
    expect(await prisma().sessions.count({ where: { user_id: o.userId } })).toBe(0)
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).status).toBe('inactive')
    const tr = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId } })
    expect(tr).toMatchObject({ status: 'cancelled', cancelled_by_admin: sa.id })
    expect(await objectStore().head(vaultKey(o.userId, 'accounts'))).toBeNull()
    expect(await objectStore().head(`shares/${o.userId}/${cs[0]!.id}/k1.enc`)).toBeNull()
    await (await api()).get('/auth/me').set(o.auth).expect(401)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'ACCOUNT_DELETE' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_id: o.userId, reason: 'demande RGPD' })
    expect(JSON.stringify(log)).not.toContain('adjoua')

    await (await api()).delete(`/admin/users/${o.userId}`).set(sa.auth).send({ reason: 'x' }).expect(409)
  })
})
