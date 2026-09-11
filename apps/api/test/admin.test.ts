// Back office (Backend Specs §3.8, Back Office Specs v1.0).

import * as OTPAuth from 'otpauth'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdmin } from '../src/api/admin/bootstrap.js'
import { vaultKey } from '../src/api/vault/service.js'
import { prisma } from '../src/lib/prisma.js'
import { objectStore } from '../src/services/storage/index.js'
import { api, closeAll, lastEmailTo, lastOtp, mailbox, registerUser, resetState, STRONG_PASSWORD } from './helpers.js'
import { activateTransmission, buildContactBody, makeOwner, opaque, openTransmission, relayTokenFromEmail, secretQuestionIds } from './transmission-helpers.js'
import { redis } from '../src/lib/redis.js'

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

// --- BO-03 Transmissions -----------------------------------------------------------

const HOUR = 3600 * 1000
const shareB64 = (seed: number) => opaque(seed, 32).toString('base64')

describe('GET /admin/transmissions', () => {
  it('liste : statuts, chiffres, escrow — sans identité de contact ni utilisateur ; filtre par statut', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    const { transmissionId, tokens } = await openTransmission(o)
    await (await api()).post(`/relay/${tokens.contact1}/verify`).send({ shares: { k1: shareB64(11) } }).expect(200)

    const r = await (await api()).get('/admin/transmissions').set(sa.auth).expect(200)
    expect(r.body.data.total).toBe(1)
    const row = r.body.data.items[0]
    expect(row).toMatchObject({
      id: transmissionId,
      status: 'in_progress',
      schema: { n: 2, m: 2 },
      contacts_notified: 2,
      contacts_confirmed: 1,
      escrow_active: true,
      escrow_extended_count: 0,
      unlocked: { k1: false, k2: false, k3: false },
    })
    expect(row.escrow_ttl_seconds).toBeGreaterThan(70 * 3600)
    const text = JSON.stringify(r.body.data)
    expect(text).not.toContain(o.userId)
    expect(text).not.toContain('contact1@')
    expect(text).not.toContain('Adjoua')

    const none = await (await api()).get('/admin/transmissions?status=completed').set(sa.auth).expect(200)
    expect(none.body.data.items).toEqual([])
  })
})

describe('GET /admin/transmissions/:id', () => {
  it('détail : contacts en statuts et compteurs seulement, journal des actions admin', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    const { transmissionId, tokens } = await openTransmission(o)
    for (let i = 0; i < 5; i++) await (await api()).post(`/relay/${tokens.contact2}/verify`).send({ failed: true })

    const r = await (await api()).get(`/admin/transmissions/${transmissionId}`).set(sa.auth).expect(200)
    expect(r.body.data).toMatchObject({ id: transmissionId, user_id: o.userId, status: 'triggered' })
    expect(r.body.data.contacts).toHaveLength(2)
    const blocked = r.body.data.contacts.find((c: { blocked: boolean }) => c.blocked)
    expect(blocked).toMatchObject({ status: 'failed', fail_count: 5, roles: { k1: true, k2: false, k3: false } })
    expect(Object.keys(blocked).sort()).toEqual(['answered_at', 'blocked', 'confirmed_at', 'fail_count', 'id', 'notified_at', 'roles', 'status'].sort())
    expect(r.body.data.audit).toEqual([])
    expect(JSON.stringify(r.body.data)).not.toContain('example.cm')
    expect(JSON.stringify(r.body.data)).not.toContain('Adjoua')
    await (await api()).get('/admin/transmissions/00000000-0000-4000-8000-000000000000').set(sa.auth).expect(404)
  })
})

describe('POST /admin/transmissions/:id/extend-escrow', () => {
  it('+24 h ou +48 h, deux fois maximum (dms.escrow_max_extensions) ; escrow et clé Redis suivent ; ESCROW_EXTEND audité', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    const { transmissionId, tokens } = await openTransmission(o)
    await (await api()).post(`/relay/${tokens.contact1}/verify`).send({ shares: { k1: shareB64(11) } }).expect(200)
    const before = await prisma().transmissions.findUniqueOrThrow({ where: { id: transmissionId } })

    const support = await adminWithRole('support')
    await (await api()).post(`/admin/transmissions/${transmissionId}/extend-escrow`).set(support.auth).send({ hours: 24, reason: 'x' }).expect(403)

    const r1 = await (await api()).post(`/admin/transmissions/${transmissionId}/extend-escrow`).set(sa.auth).send({ hours: 24, reason: 'contact 2 en voyage' }).expect(200)
    expect(r1.body.data).toMatchObject({ escrow_extended_count: 1 })
    expect(Date.parse(r1.body.data.escrow_expires_at) - before.escrow_expires_at.getTime()).toBe(24 * HOUR)
    const es = await prisma().escrow_shares.findFirstOrThrow({ where: { transmission_id: transmissionId } })
    expect(es.expires_at.getTime() - before.escrow_expires_at.getTime()).toBe(24 * HOUR)
    expect(await redis().ttl(`escrow:key:${transmissionId}`)).toBeGreaterThan(95 * 3600)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'ESCROW_EXTEND' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_type: 'transmission', target_id: transmissionId, reason: 'contact 2 en voyage' })

    await (await api()).post(`/admin/transmissions/${transmissionId}/extend-escrow`).set(sa.auth).send({ hours: 48, reason: 'encore' }).expect(200)
    const third = await (await api()).post(`/admin/transmissions/${transmissionId}/extend-escrow`).set(sa.auth).send({ hours: 24, reason: 'trop' }).expect(409)
    expect(third.body.error.code).toBe('ESCROW_MAX_EXTENSIONS')
    const bad = await (await api()).post(`/admin/transmissions/${transmissionId}/extend-escrow`).set(sa.auth).send({ hours: 12, reason: 'x' }).expect(400)
    expect(bad.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST /admin/transmissions/:id/notify', () => {
  it('relance les contacts qui n’ont pas répondu avec un nouveau lien ; l’ancien meurt ; TRANSMISSION_NOTIFY audité', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    const { transmissionId, tokens } = await openTransmission(o)
    await (await api()).post(`/relay/${tokens.contact1}/verify`).send({ shares: { k1: shareB64(11) } }).expect(200)
    mailbox.clear()

    const r = await (await api()).post(`/admin/transmissions/${transmissionId}/notify`).set(sa.auth).send({ reason: 'pas de nouvelles' }).expect(200)
    expect(r.body.data).toEqual({ notified: 1 })
    expect(lastEmailTo('contact1@example.cm')).toBeUndefined()
    const fresh = relayTokenFromEmail('contact2@example.cm')
    expect(fresh).not.toBe(tokens.contact2)
    await (await api()).get(`/relay/${tokens.contact2}`).expect(404)
    await (await api()).get(`/relay/${fresh}`).expect(200)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'TRANSMISSION_NOTIFY' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_id: transmissionId })
  })
})

describe('DELETE /admin/transmissions/:id', () => {
  it('super_admin : annule, purge l’escrow, rend la transmission à l’owner (config active, check-in replanifié), audite', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    const { transmissionId, tokens } = await openTransmission(o)
    await (await api()).post(`/relay/${tokens.contact1}/verify`).send({ shares: { k1: shareB64(11) } }).expect(200)

    const adminRole = await adminWithRole('admin')
    await (await api()).delete(`/admin/transmissions/${transmissionId}`).set(adminRole.auth).send({ reason: 'x' }).expect(403)

    const before = Date.now()
    const r = await (await api()).delete(`/admin/transmissions/${transmissionId}`).set(sa.auth).send({ reason: 'owner vivant, vérifié par téléphone' }).expect(200)
    expect(r.body.data).toMatchObject({ status: 'cancelled' })
    const tr = await prisma().transmissions.findUniqueOrThrow({ where: { id: transmissionId } })
    expect(tr).toMatchObject({ status: 'cancelled', cancelled_by_admin: sa.id, cancellation_reason: 'owner vivant, vérifié par téléphone' })
    expect(await prisma().escrow_shares.count({ where: { transmission_id: transmissionId } })).toBe(0)
    expect(await redis().exists(`escrow:key:${transmissionId}`)).toBe(0)
    await (await api()).get(`/relay/${tokens.contact1}`).expect(404)
    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    expect(cfg.status).toBe('active')
    expect(cfg.relance_count).toBe(0)
    expect(cfg.next_checkin_due!.getTime()).toBeGreaterThan(before)
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'TRANSMISSION_CANCEL' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_id: transmissionId, user_id: o.userId })

    await (await api()).delete(`/admin/transmissions/${transmissionId}`).set(sa.auth).send({ reason: 'x' }).expect(409)
  })
})

describe('POST /admin/transmissions/:id/contacts/:cid/unblock', () => {
  it('remet les 5 tentatives du contact, sans rien révéler ; CONTACT_UNBLOCK audité', async () => {
    const o = await makeOwner()
    const { transmissionId, tokens } = await openTransmission(o)
    for (let i = 0; i < 5; i++) await (await api()).post(`/relay/${tokens.contact2}/verify`).send({ failed: true })
    await (await api()).get(`/relay/${tokens.contact2}`).expect(423)
    const blocked = await prisma().transmission_contacts.findFirstOrThrow({ where: { transmission_id: transmissionId, blocked: true } })

    const support = await adminWithRole('support')
    const r = await (await api()).post(`/admin/transmissions/${transmissionId}/contacts/${blocked.id}/unblock`).set(support.auth).send({ reason: 'appel du contact' }).expect(200)
    expect(r.body.data).toMatchObject({ id: blocked.id, status: 'notified', fail_count: 0, blocked: false })
    await (await api()).get(`/relay/${tokens.contact2}`).expect(200)
    const tc = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id: blocked.trusted_contact_id } })
    expect(tc.blocked_until).toBeNull()
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'CONTACT_UNBLOCK' } })
    expect(log).toMatchObject({ admin_id: support.id, target_type: 'transmission', target_id: transmissionId })
  })
})

// --- BO-04 Questions, BO-05 Configuration, BO-06 Audit et santé -------------------------

const QUESTION = {
  text_fr: 'Quel surnom vous donnait votre grand-mère maternelle ?',
  text_en: 'What nickname did your maternal grandmother give you?',
  category: 'childhood',
  usage_type: 'secret_question',
  reliability_score: 9,
  risk_notes: 'Stable, privé, non public.',
}

describe('BO-04 /admin/questions', () => {
  it('liste filtrable (rôle admin) ; ajout audité ; doublon de libellé → 409', async () => {
    const sa = await superAdmin()
    const support = await adminWithRole('support')
    await (await api()).get('/admin/questions').set(support.auth).expect(403)

    const all = await (await api()).get('/admin/questions?usage_type=secret_question&status=active').set(sa.auth).expect(200)
    expect(all.body.data.length).toBeGreaterThanOrEqual(31)
    expect(all.body.data[0]).toMatchObject({ usage_type: 'secret_question', status: 'active' })
    expect(Object.keys(all.body.data[0])).toEqual(expect.arrayContaining(['id', 'text_fr', 'text_en', 'category', 'reliability_score', 'status', 'usage_count', 'risk_notes']))

    const created = await (await api()).post('/admin/questions').set(sa.auth).send(QUESTION).expect(201)
    expect(created.body.data).toMatchObject({ ...QUESTION, status: 'active', usage_count: 0 })
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'QUESTION_ADD' } })
    expect(log).toMatchObject({ admin_id: sa.id, target_type: 'question', target_id: created.body.data.id })

    const dup = await (await api()).post('/admin/questions').set(sa.auth).send({ ...QUESTION, text_en: 'Other wording' }).expect(409)
    expect(dup.body.error.code).toBe('QUESTION_DUPLICATE')
    const badCat = await (await api()).post('/admin/questions').set(sa.auth).send({ ...QUESTION, text_fr: 'Autre ?', text_en: 'Other?', category: 'astrology' }).expect(400)
    expect(badCat.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('modification auditée avant/après ; archivage : plus proposée aux nouveaux contacts, les usages existants restent', async () => {
    const sa = await superAdmin()
    const o = await makeOwner()
    const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
    const body = await buildContactBody(o.keys, o.relaisPk, { notification: { email: 'h@example.cm', phone: '+237699000000' }, roles: { k1: true }, question_ids: [q1, q2, q3] })
    const contact = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(201)

    const upd = await (await api()).put(`/admin/questions/${q1}`).set(sa.auth).send({ reliability_score: 4, risk_notes: 'devinable via les réseaux' }).expect(200)
    expect(upd.body.data).toMatchObject({ id: q1, reliability_score: 4, risk_notes: 'devinable via les réseaux' })
    const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'QUESTION_UPDATE' } })
    expect(log.value_before).toMatchObject({ reliability_score: expect.any(Number) })
    expect(log.value_after).toMatchObject({ reliability_score: 4 })

    const arch = await (await api()).put(`/admin/questions/${q1}/archive`).set(sa.auth).send({ reason: 'score trop bas' }).expect(200)
    expect(arch.body.data.status).toBe('archived')
    expect(await prisma().audit_logs.count({ where: { action: 'QUESTION_ARCHIVE', target_id: q1 } })).toBe(1)
    // l'usage existant reste
    expect((await prisma().trusted_contacts.findUniqueOrThrow({ where: { id: contact.body.data.id } })).question_1_id).toBe(q1)
    // mais un nouveau contact ne peut plus la choisir
    const [q4] = (await secretQuestionIds(4)).slice(3) as [string]
    const again = await buildContactBody(o.keys, o.relaisPk, { notification: { email: 'h2@example.cm', phone: '+237699000001' }, roles: { k1: true }, question_ids: [q1, q2, q4], secretSeed: 2 })
    const r = await (await api()).post('/transmission/contacts').set(o.auth).send(again).expect(400)
    expect(r.body.error.details.question_ids).toContain(q1)
    await (await api()).put('/admin/questions/00000000-0000-4000-8000-000000000000/archive').set(sa.auth).send({ reason: 'x' }).expect(404)
  })
})

describe('BO-05 /admin/config', () => {
  it('super_admin seulement : lecture typée, modification validée par type, avant/après audité, effet immédiat', async () => {
    const sa = await superAdmin()
    const adminRole = await adminWithRole('admin')
    await (await api()).get('/admin/config').set(adminRole.auth).expect(403)

    const all = await (await api()).get('/admin/config').set(sa.auth).expect(200)
    const minScore = all.body.data.find((c: { key: string }) => c.key === 'vault.question_min_score')
    expect(minScore).toMatchObject({ value: 6, config_type: 'int', category: 'vault', updated_by: null })
    const intervals = all.body.data.find((c: { key: string }) => c.key === 'dms.relance_intervals_days')
    expect(intervals.value).toEqual([7, 14, 21])

    const badType = await (await api()).put('/admin/config/vault.question_min_score').set(sa.auth).send({ value: 'sept' }).expect(400)
    expect(badType.body.error.code).toBe('VALIDATION_ERROR')
    await (await api()).put('/admin/config/dms.relance_intervals_days').set(sa.auth).send({ value: [7, 'x'] }).expect(400)
    await (await api()).put('/admin/config/nope.key').set(sa.auth).send({ value: 1 }).expect(404)

    try {
      const r = await (await api()).put('/admin/config/vault.question_min_score').set(sa.auth).send({ value: 10, reason: 'durcissement' }).expect(200)
      expect(r.body.data).toMatchObject({ key: 'vault.question_min_score', value: 10, updated_by: sa.id })
      const log = await prisma().audit_logs.findFirstOrThrow({ where: { action: 'CONFIG_UPDATE' } })
      expect(log).toMatchObject({ target_type: 'config', target_id: 'vault.question_min_score', reason: 'durcissement' })
      expect(log.value_before).toEqual({ value: '6' })
      expect(log.value_after).toEqual({ value: '10' })

      // effet immédiat : une question de score 9 n'est plus acceptable
      const o = await makeOwner()
      const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
      const body = await buildContactBody(o.keys, o.relaisPk, { notification: { email: 'h@example.cm', phone: '+237699000000' }, roles: { k1: true }, question_ids: [q1, q2, q3] })
      await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(400)
    } finally {
      await prisma().app_config.update({ where: { key: 'vault.question_min_score' }, data: { value: '6', updated_by: null } })
    }
  })
})

describe('BO-06 /admin/logs/audit et /admin/health', () => {
  it('journal filtrable par action, admin, cible ; santé des services pour un admin', async () => {
    const sa = await superAdmin()
    const u = await registerUser('adjoua@example.cm')
    await (await api()).post(`/admin/users/${u.userId}/unblock`).set(sa.auth).send({ reason: 'r' }).expect(200)

    const logs = await (await api()).get(`/admin/logs/audit?action=ACCOUNT_UNBLOCK`).set(sa.auth).expect(200)
    expect(logs.body.data.total).toBe(1)
    expect(logs.body.data.items[0]).toMatchObject({ action: 'ACCOUNT_UNBLOCK', admin_id: sa.id, target_id: u.userId, reason: 'r' })
    expect(logs.body.data.items[0].ip_hash).toHaveLength(64)
    const byTarget = await (await api()).get(`/admin/logs/audit?target_id=${u.userId}`).set(sa.auth).expect(200)
    expect(byTarget.body.data.total).toBe(1)
    const byAdmin = await (await api()).get(`/admin/logs/audit?admin_id=${sa.id}`).set(sa.auth).expect(200)
    expect(byAdmin.body.data.total).toBe(2) // login + unblock

    const finance = await adminWithRole('finance')
    await (await api()).get('/admin/health').set(finance.auth).expect(403)
    const health = await (await api()).get('/admin/health').set(sa.auth).expect(200)
    expect(health.body.data).toMatchObject({ status: 'ok', services: { postgres: 'ok', redis: 'ok' }, jobs: { enabled: false } })
    expect(health.body.data.counts).toMatchObject({ users: 1, transmissions_open: 0 })
  })
})
