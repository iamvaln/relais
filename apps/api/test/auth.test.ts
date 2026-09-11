import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as OTPAuth from 'otpauth'
import { createHash } from 'node:crypto'
import { prisma } from '../src/lib/prisma.js'
import { redis } from '../src/lib/redis.js'
import { passwordResetMessage } from '../src/api/auth/service.js'
import {
  STRONG_PASSWORD,
  api,
  closeAll,
  cookieValue,
  generateDeviceKeys,
  lastEmailTo,
  lastOtp,
  mailbox,
  refreshCookie,
  registerUser,
  resetState,
  signWith,
  stepUp,
} from './helpers.js'

beforeEach(resetState)
afterAll(closeAll)

const EMAIL = 'adjoua@example.cm'

describe('GET /health', () => {
  it('répond dans l’enveloppe avec le statut de chaque service', async () => {
    const res = await (await api()).get('/health').expect(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.services).toMatchObject({ postgres: 'ok', redis: 'ok' })
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000')
  })

  it('renvoie NOT_FOUND dans l’enveloppe pour une route inconnue', async () => {
    const res = await (await api()).get('/nope').expect(404)
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: expect.any(String) } })
  })
})

describe('inscription (E1-US01)', () => {
  it('ne crée rien en base avant l’OTP, puis crée user + subscription', async () => {
    const client = await api()
    await client
      .post('/auth/register')
      .send({ full_name: 'Adjoua Ngo', email: EMAIL, phone: '+237690000000', password: STRONG_PASSWORD })
      .expect(200)

    expect(await prisma().users.count()).toBe(0)
    const otp = await prisma().email_otp.findFirstOrThrow({ where: { email: EMAIL } })
    expect(otp.user_id).toBeNull()
    expect(otp.purpose).toBe('registration')
    expect(otp.otp_hash).toHaveLength(64)
    expect(otp.otp_hash).not.toContain(lastOtp())

    const res = await client.post('/auth/email/verify').send({ email: EMAIL, code: lastOtp() }).expect(200)
    expect(res.body.data.user).toMatchObject({ email: EMAIL, plan: 'free', totp_enabled: false, has_public_key: false })
    expect(res.body.data.access_token).toBeTypeOf('string')

    const user = await prisma().users.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(user.account_status).toBe('active')
    expect(user.email_verified).toBe(true)
    expect(user.password_hash.startsWith('$argon2id$')).toBe(true)
    expect(await prisma().subscriptions.count({ where: { user_id: user.id, plan: 'free' } })).toBe(1)
    expect(await redis().get(`reg:pending:${EMAIL}`)).toBeNull()
  })

  it('pose le cookie refresh avec les bons attributs (§7.2)', async () => {
    const { cookie } = await registerUser(EMAIL)
    expect(cookie).toMatch(/^refresh_token=/)
    expect(cookie).toContain('Path=/auth/refresh')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('refuse un mot de passe faible avec le détail', async () => {
    const res = await (await api())
      .post('/auth/register')
      .send({ full_name: 'A B', email: EMAIL, phone: '+237690000000', password: 'toutenminuscules' })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details.password).toEqual(expect.arrayContaining(['au moins une majuscule']))
  })

  it('refuse un champ inconnu (§7.3 additionalProperties: false)', async () => {
    const res = await (await api())
      .post('/auth/register')
      .send({ full_name: 'A B', email: EMAIL, phone: '+237690000000', password: STRONG_PASSWORD, admin: true })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('répond pareil qu’un email soit libre ou déjà pris, sans email envoyé au second', async () => {
    await registerUser(EMAIL)
    mailbox.clear()
    const res = await (await api())
      .post('/auth/register')
      .send({ full_name: 'Autre', email: EMAIL, phone: '+237690000001', password: STRONG_PASSWORD })
      .expect(200)
    expect(res.body).toEqual({ success: true, data: { pending: true } })
    expect(mailbox.sent).toHaveLength(0)
  })

  it('invalide l’OTP après 5 mauvais codes', async () => {
    const client = await api()
    await client
      .post('/auth/register')
      .send({ full_name: 'A B', email: EMAIL, phone: '+237690000000', password: STRONG_PASSWORD })
      .expect(200)
    const good = lastOtp()
    const bad = good === '000000' ? '111111' : '000000'
    for (let i = 1; i <= 4; i++) {
      const r = await client.post('/auth/email/verify').send({ email: EMAIL, code: bad }).expect(401)
      expect(r.body.error.code).toBe('AUTH_OTP_INVALID')
    }
    const r5 = await client.post('/auth/email/verify').send({ email: EMAIL, code: bad }).expect(429)
    expect(r5.body.error.code).toBe('AUTH_OTP_EXHAUSTED')
    // Même le bon code ne passe plus
    await client.post('/auth/email/verify').send({ email: EMAIL, code: good }).expect(401)
  })

  it('resend invalide l’ancien code et en envoie un nouveau', async () => {
    const client = await api()
    await client
      .post('/auth/register')
      .send({ full_name: 'A B', email: EMAIL, phone: '+237690000000', password: STRONG_PASSWORD })
      .expect(200)
    const first = lastOtp()
    await client.post('/auth/email/resend-otp').send({ email: EMAIL }).expect(200)
    const second = lastOtp()
    expect(second).not.toBe(first)
    await client.post('/auth/email/verify').send({ email: EMAIL, code: first }).expect(401)
    await client.post('/auth/email/verify').send({ email: EMAIL, code: second }).expect(200)
  })

  it('trace chaque email dans email_log avec le hash, jamais l’adresse', async () => {
    await registerUser(EMAIL)
    const logs = await prisma().email_log.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.email_type).toBe('otp_registration')
    expect(logs[0]!.recipient_hash).toHaveLength(64)
    expect(logs[0]!.status).toBe('sent')
    expect(JSON.stringify(logs)).not.toContain(EMAIL)
  })
})

describe('connexion et sessions (§2.2, §2.5)', () => {
  it('login → access token + cookie ; refresh fait tourner le token ; logout révoque', async () => {
    const { email, password } = await registerUser(EMAIL)
    const client = await api()

    const login = await client.post('/auth/login').send({ email, password }).expect(200)
    const access = login.body.data.access_token as string
    const cookie1 = refreshCookie(login)!
    expect(await prisma().sessions.count()).toBe(2) // verify + login

    const refresh = await client.post('/auth/refresh').set('Cookie', cookieValue(cookie1)).expect(200)
    const cookie2 = refreshCookie(refresh)!
    expect(cookieValue(cookie2)).not.toBe(cookieValue(cookie1))
    expect(refresh.body.data.access_token).toBeTypeOf('string')

    // L'ancien refresh token ne vaut plus rien
    const replay = await client.post('/auth/refresh').set('Cookie', cookieValue(cookie1)).expect(401)
    expect(replay.body.error.code).toBe('AUTH_TOKEN_EXPIRED')

    await client.post('/auth/logout').set('Authorization', `Bearer ${access}`).expect(200)
    expect(await prisma().sessions.count()).toBe(1)
    await client.post('/auth/refresh').set('Cookie', cookieValue(cookie2)).expect(401)
    // Le token d'accès de la session fermée est refusé sans attendre son expiration
    await client.get('/auth/me').set('Authorization', `Bearer ${access}`).expect(401)
  })

  it('verrouille 15 minutes après 5 échecs et envoie un email (§2.5)', async () => {
    const { email } = await registerUser(EMAIL)
    const client = await api()
    mailbox.clear()
    for (let i = 1; i <= 4; i++) {
      const r = await client.post('/auth/login').send({ email, password: 'Wrong-Password-1!' }).expect(401)
      expect(r.body.error.code).toBe('AUTH_INVALID_CREDENTIALS')
    }
    const r5 = await client.post('/auth/login').send({ email, password: 'Wrong-Password-1!' }).expect(423)
    expect(r5.body.error.code).toBe('AUTH_ACCOUNT_LOCKED')
    expect(lastEmailTo(email)?.subject).toMatch(/Tentatives de connexion/)

    const user = await prisma().users.findUniqueOrThrow({ where: { email } })
    expect(user.login_locked_until!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)

    // Même le bon mot de passe est refusé pendant le verrou
    const locked = await client.post('/auth/login').send({ email, password: STRONG_PASSWORD }).expect(423)
    expect(locked.body.error.code).toBe('AUTH_ACCOUNT_LOCKED')
  })

  it('ne distingue pas un compte inexistant d’un mauvais mot de passe', async () => {
    const r = await (await api()).post('/auth/login').send({ email: 'nobody@example.cm', password: 'x' }).expect(401)
    expect(r.body.error.code).toBe('AUTH_INVALID_CREDENTIALS')
  })

  it('coupe un compte suspendu immédiatement, token valide ou pas', async () => {
    const { accessToken, userId } = await registerUser(EMAIL)
    const client = await api()
    await client.get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200)
    await prisma().users.update({ where: { id: userId }, data: { account_status: 'suspended' } })
    const r = await client.get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(403)
    expect(r.body.error.code).toBe('AUTH_ACCOUNT_SUSPENDED')
  })

  it('refuse un token absent ou malformé', async () => {
    const client = await api()
    expect((await client.get('/auth/me').expect(401)).body.error.code).toBe('AUTH_TOKEN_INVALID')
    expect((await client.get('/auth/me').set('Authorization', 'Bearer nope').expect(401)).body.error.code).toBe(
      'AUTH_TOKEN_INVALID',
    )
  })
})

describe('step-up (DEC-25) et actions sensibles', () => {
  it('exige un step-up, refuse la mauvaise action, et n’accepte qu’un seul usage', async () => {
    const { accessToken } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }

    const noToken = await client.post('/auth/seed/display').set(auth).expect(403)
    expect(noToken.body.error.code).toBe('AUTH_STEPUP_REQUIRED')

    const wrongAction = await stepUp(accessToken, 'edit_contacts')
    const wrong = await client.post('/auth/seed/display').set(auth).set('X-Step-Up-Token', wrongAction).expect(403)
    expect(wrong.body.error.code).toBe('AUTH_STEPUP_INVALID')

    const token = await stepUp(accessToken, 'view_seed')
    const first = await client.post('/auth/seed/display').set(auth).set('X-Step-Up-Token', token).expect(200)
    expect(first.body.data).toEqual({ authorized: true })

    const replay = await client.post('/auth/seed/display').set(auth).set('X-Step-Up-Token', token).expect(403)
    expect(replay.body.error.code).toBe('AUTH_STEPUP_INVALID')
  })

  it('un step-up refusé (mauvaise action) ne consomme pas le jti', async () => {
    const { accessToken } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }
    const token = await stepUp(accessToken, 'view_seed')
    // Mauvais endpoint d'abord…
    await client.put('/auth/password').set(auth).set('X-Step-Up-Token', token).send({ current_password: 'x', new_password: STRONG_PASSWORD }).expect(403)
    // …le token reste utilisable pour la bonne action
    await client.post('/auth/seed/display').set(auth).set('X-Step-Up-Token', token).expect(200)
  })

  it('un step-up d’un autre utilisateur est refusé', async () => {
    const a = await registerUser(EMAIL)
    const b = await registerUser('herve@example.cm')
    const tokenB = await stepUp(b.accessToken, 'view_seed')
    const r = await (await api())
      .post('/auth/seed/display')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .set('X-Step-Up-Token', tokenB)
      .expect(403)
    expect(r.body.error.code).toBe('AUTH_STEPUP_INVALID')
  })

  it('changement de mot de passe : step-up, ancien mdp, révoque les autres sessions, notifie', async () => {
    const { email, password, accessToken } = await registerUser(EMAIL)
    const client = await api()
    // Une deuxième session
    const other = await client.post('/auth/login').send({ email, password }).expect(200)
    const otherAccess = other.body.data.access_token as string
    expect(await prisma().sessions.count()).toBe(2)

    const token = await stepUp(accessToken, 'change_password')
    const bad = await client
      .put('/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Step-Up-Token', token)
      .send({ current_password: 'Wrong-Old-1!', new_password: 'New-Password-9!' })
      .expect(401)
    expect(bad.body.error.code).toBe('AUTH_INVALID_CREDENTIALS')

    mailbox.clear()
    const token2 = await stepUp(accessToken, 'change_password')
    const r = await client
      .put('/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Step-Up-Token', token2)
      .send({ current_password: password, new_password: 'New-Password-9!' })
      .expect(200)
    expect(r.body.data).toEqual({ changed: true, revoked_sessions: 1 })
    expect(lastEmailTo(email)?.subject).toMatch(/mot de passe/)

    // L'autre session est morte immédiatement — son access token, pourtant
    // pas expiré, ne vaut plus rien. La courante vit.
    await client.get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200)
    const dead = await client.get('/auth/me').set('Authorization', `Bearer ${otherAccess}`).expect(401)
    expect(dead.body.error.code).toBe('AUTH_TOKEN_INVALID')
    expect(await prisma().sessions.count()).toBe(1)

    await client.post('/auth/login').send({ email, password }).expect(401)
    await client.post('/auth/login').send({ email, password: 'New-Password-9!' }).expect(200)
  })
})

describe('clé publique et restauration Ed25519 (DEC-05, DEC-06)', () => {
  it('enregistre la clé une seule fois et refuse une taille invalide', async () => {
    const { accessToken } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }
    const keys = generateDeviceKeys()

    const short = await client.post('/auth/keys').set(auth).send({ ed25519_pk: Buffer.alloc(16).toString('base64') }).expect(400)
    expect(short.body.error.code).toBe('VALIDATION_ERROR')

    await client.post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)
    const me = await client.get('/auth/me').set(auth).expect(200)
    expect(me.body.data.has_public_key).toBe(true)

    const again = await client.post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(409)
    expect(again.body.error.code).toBe('AUTH_KEY_ALREADY_SET')
  })

  it('challenge → signature valide → vérifié + email ; le challenge est à usage unique', async () => {
    const { email, accessToken } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }

    const noKey = await client.get('/auth/restore/challenge').set(auth).expect(409)
    expect(noKey.body.error.code).toBe('AUTH_KEY_NOT_SET')

    const keys = generateDeviceKeys()
    await client.post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)

    const ch = await client.get('/auth/restore/challenge').set(auth).expect(200)
    const challenge = Buffer.from(ch.body.data.challenge, 'base64')
    expect(challenge).toHaveLength(32)

    mailbox.clear()
    const signature = signWith(keys, challenge)
    const ok = await client
      .post('/auth/restore/verify')
      .set(auth)
      .send({ challenge_id: ch.body.data.challenge_id, signature })
      .expect(200)
    expect(ok.body.data).toEqual({ verified: true })
    expect(lastEmailTo(email)?.subject).toMatch(/restauré/)

    const replay = await client
      .post('/auth/restore/verify')
      .set(auth)
      .send({ challenge_id: ch.body.data.challenge_id, signature })
      .expect(401)
    expect(replay.body.error.code).toBe('AUTH_RESTORE_FAILED')
  })

  it('une signature d’une autre clé (mauvais 12 mots) est refusée et brûle le challenge', async () => {
    const { accessToken } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }
    const keys = generateDeviceKeys()
    const impostor = generateDeviceKeys()
    await client.post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)

    const ch = await client.get('/auth/restore/challenge').set(auth).expect(200)
    const challenge = Buffer.from(ch.body.data.challenge, 'base64')

    const bad = await client
      .post('/auth/restore/verify')
      .set(auth)
      .send({ challenge_id: ch.body.data.challenge_id, signature: signWith(impostor, challenge) })
      .expect(401)
    expect(bad.body.error.code).toBe('AUTH_RESTORE_FAILED')

    // La bonne signature sur le même challenge ne passe plus : usage unique
    await client
      .post('/auth/restore/verify')
      .set(auth)
      .send({ challenge_id: ch.body.data.challenge_id, signature: signWith(keys, challenge) })
      .expect(401)
  })

  it('un challenge expiré est refusé', async () => {
    const { accessToken } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }
    const keys = generateDeviceKeys()
    await client.post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)
    const ch = await client.get('/auth/restore/challenge').set(auth).expect(200)
    await prisma().restore_challenges.update({
      where: { id: ch.body.data.challenge_id },
      data: { expires_at: new Date(Date.now() - 1000) },
    })
    const r = await client
      .post('/auth/restore/verify')
      .set(auth)
      .send({ challenge_id: ch.body.data.challenge_id, signature: signWith(keys, Buffer.from(ch.body.data.challenge, 'base64')) })
      .expect(401)
    expect(r.body.error.code).toBe('AUTH_RESTORE_FAILED')
  })
})

describe('réinitialisation du mot de passe (E1-US05)', () => {
  it('sans clé publique : OTP seul suffit, toutes les sessions tombent', async () => {
    const { email, accessToken } = await registerUser(EMAIL)
    const client = await api()
    mailbox.clear()
    await client.post('/auth/password/reset-request').send({ email }).expect(200)
    const code = lastOtp()
    await client.post('/auth/password/reset').send({ email, code, new_password: 'Reset-Password-7!' }).expect(200)
    await client.get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401)
    await client.post('/auth/login').send({ email, password: 'Reset-Password-7!' }).expect(200)
  })

  it('avec clé publique : la signature des 12 mots est obligatoire et vérifiée avant de brûler l’OTP', async () => {
    const { email, accessToken } = await registerUser(EMAIL)
    const client = await api()
    const keys = generateDeviceKeys()
    await client.post('/auth/keys').set('Authorization', `Bearer ${accessToken}`).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)

    mailbox.clear()
    await client.post('/auth/password/reset-request').send({ email }).expect(200)
    const code = lastOtp()

    // Sans signature : refusé, et l'OTP n'est PAS consommé
    const noSig = await client.post('/auth/password/reset').send({ email, code, new_password: 'Reset-Password-7!' }).expect(401)
    expect(noSig.body.error.code).toBe('AUTH_RESTORE_FAILED')

    // Mauvaise clé : refusé, OTP toujours intact
    const impostor = generateDeviceKeys()
    await client
      .post('/auth/password/reset')
      .send({ email, code, new_password: 'Reset-Password-7!', signature: signWith(impostor, passwordResetMessage(email, code)) })
      .expect(401)
    const otp = await prisma().email_otp.findFirstOrThrow({ where: { email, purpose: 'password_reset' } })
    expect(otp.used_at).toBeNull()
    expect(otp.attempts).toBe(0)

    // Bonne clé : passe
    await client
      .post('/auth/password/reset')
      .send({ email, code, new_password: 'Reset-Password-7!', signature: signWith(keys, passwordResetMessage(email, code)) })
      .expect(200)
    await client.post('/auth/login').send({ email, password: 'Reset-Password-7!' }).expect(200)
  })

  it('reset-request sur un email inconnu répond pareil et n’envoie rien', async () => {
    const r = await (await api()).post('/auth/password/reset-request').send({ email: 'nobody@example.cm' }).expect(200)
    expect(r.body).toEqual({ success: true, data: { pending: true } })
    expect(mailbox.sent).toHaveLength(0)
  })
})

describe('2FA TOTP (E6-US02)', () => {
  function codeFor(secret: string): string {
    return new OTPAuth.TOTP({ secret, digits: 6, period: 30 }).generate()
  }

  it('codes de récupération (Point-2) : 8 codes rendus une fois à l’activation, un code remplace le TOTP au login, usage unique, purgés à la désactivation', async () => {
    const { email, password, accessToken, userId } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }
    const setup = await client.post('/auth/2fa/setup').set(auth).expect(200)
    const secret = setup.body.data.secret as string

    const on = await client.post('/auth/2fa/verify').set(auth).send({ code: codeFor(secret) }).expect(200)
    const codes = on.body.data.recovery_codes as string[]
    expect(codes).toHaveLength(8)
    expect(new Set(codes).size).toBe(8)
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/)
    const rows = await prisma().two_factor_recovery_codes.findMany({ where: { user_id: userId } })
    expect(rows).toHaveLength(8)
    expect(rows.every((r) => r.used_at === null)).toBe(true)
    expect(rows.map((r) => r.code_hash).sort()).toEqual(codes.map((c) => createHash('sha256').update(c).digest('hex')).sort())

    // Au login, un code de secours remplace le TOTP — casse indifférente
    const login = await client.post('/auth/login').send({ email, password }).expect(200)
    const temp = login.body.data.temp_token as string
    const bad = await client.post('/auth/2fa/verify').send({ temp_token: temp, recovery_code: 'aaaaa-aaaaa' }).expect(401)
    expect(bad.body.error.code).toBe('AUTH_2FA_INVALID')
    const done = await client.post('/auth/2fa/verify').send({ temp_token: temp, recovery_code: codes[0]!.toUpperCase() }).expect(200)
    expect(done.body.data.access_token).toBeTypeOf('string')
    expect((await prisma().two_factor_recovery_codes.findMany({ where: { user_id: userId, used_at: { not: null } } })).length).toBe(1)

    // Un code ne sert qu'une fois
    const temp2 = (await client.post('/auth/login').send({ email, password }).expect(200)).body.data.temp_token as string
    const reuse = await client.post('/auth/2fa/verify').send({ temp_token: temp2, recovery_code: codes[0] }).expect(401)
    expect(reuse.body.error.code).toBe('AUTH_2FA_INVALID')
    await client.post('/auth/2fa/verify').send({ temp_token: temp2, recovery_code: codes[1] }).expect(200)

    // Ni code ni code de secours : 400
    const temp3 = (await client.post('/auth/login').send({ email, password }).expect(200)).body.data.temp_token as string
    await client.post('/auth/2fa/verify').send({ temp_token: temp3 }).expect(400)

    // La désactivation purge les codes
    const su = await stepUp(accessToken, 'disable_2fa')
    await client.delete('/auth/2fa').set(auth).set('X-Step-Up-Token', su).send({ code: codeFor(secret) }).expect(200)
    expect(await prisma().two_factor_recovery_codes.count({ where: { user_id: userId } })).toBe(0)
  })

  it('setup → verify active ; le login exige ensuite un code ; DELETE désactive avec step-up', async () => {
    const { email, password, accessToken } = await registerUser(EMAIL)
    const client = await api()
    const auth = { Authorization: `Bearer ${accessToken}` }

    const setup = await client.post('/auth/2fa/setup').set(auth).expect(200)
    const secret = setup.body.data.secret as string
    expect(setup.body.data.otpauth_uri).toMatch(/^otpauth:\/\/totp\/Relais:/)
    expect((await prisma().users.findUniqueOrThrow({ where: { email } })).totp_enabled).toBe(false)

    const badCode = await client.post('/auth/2fa/verify').set(auth).send({ code: '000000' }).expect(401)
    expect(badCode.body.error.code).toBe('AUTH_2FA_INVALID')

    mailbox.clear()
    await client.post('/auth/2fa/verify').set(auth).send({ code: codeFor(secret) }).expect(200)
    expect((await prisma().users.findUniqueOrThrow({ where: { email } })).totp_enabled).toBe(true)
    expect(lastEmailTo(email)?.subject).toMatch(/Double authentification activée/)

    // Login : plus de session directe
    const login = await client.post('/auth/login').send({ email, password }).expect(200)
    expect(login.body.data.requires_2fa).toBe(true)
    expect(login.body.data.access_token).toBeUndefined()
    expect(refreshCookie(login)).toBeUndefined()
    const temp = login.body.data.temp_token as string

    const wrong = await client.post('/auth/2fa/verify').send({ temp_token: temp, code: '000000' }).expect(401)
    expect(wrong.body.error.code).toBe('AUTH_2FA_INVALID')

    const done = await client.post('/auth/2fa/verify').send({ temp_token: temp, code: codeFor(secret) }).expect(200)
    expect(done.body.data.access_token).toBeTypeOf('string')
    expect(refreshCookie(done)).toBeDefined()

    // temp_token à usage unique
    const reuse = await client.post('/auth/2fa/verify').send({ temp_token: temp, code: codeFor(secret) }).expect(401)
    expect(reuse.body.error.code).toBe('AUTH_TOKEN_EXPIRED')

    // Désactivation : step-up + code
    const noStepUp = await client.delete('/auth/2fa').set(auth).send({ code: codeFor(secret) }).expect(403)
    expect(noStepUp.body.error.code).toBe('AUTH_STEPUP_REQUIRED')
    const su = await stepUp(accessToken, 'disable_2fa')
    await client.delete('/auth/2fa').set(auth).set('X-Step-Up-Token', su).send({ code: codeFor(secret) }).expect(200)
    const after = await prisma().users.findUniqueOrThrow({ where: { email } })
    expect(after.totp_enabled).toBe(false)
    expect(after.totp_secret).toBeNull()

    await client.post('/auth/login').send({ email, password }).expect(200)
  })
})

describe('rate limiting (§7.1)', () => {
  it('expose les en-têtes et bloque au-delà de la limite de login', async () => {
    const client = await api()
    let last: { status: number; headers: Record<string, string>; body: { error?: { code: string } } } | undefined
    for (let i = 0; i < 11; i++) {
      last = await client.post('/auth/login').send({ email: 'nobody@example.cm', password: 'x' })
    }
    expect(last!.status).toBe(429)
    expect(last!.body.error?.code).toBe('RATE_LIMITED')
    expect(last!.headers['x-ratelimit-limit']).toBe('10')
    expect(last!.headers['retry-after']).toBeDefined()
  })
})
