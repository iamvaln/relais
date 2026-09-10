// Logique métier du module auth (Backend Specs §2, §3.1 v1.1).
//
// Ce que le serveur sait : email, hash Argon2id du mot de passe, clé publique
// Ed25519. Ce qu'il ne saura jamais : seed, PIN, K1/K2/K3 (DEC-02, DEC-05).

import { randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import { env } from '../../config/env.js'
import {
  ED25519_PK_BYTES,
  decodeBase64,
  ed25519Verify,
  hashPassword,
  hmacToken,
  randomOtp,
  randomToken,
  safeEqualHex,
  sha256Hex,
  verifyPassword,
} from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { signAccessToken, signStepUpToken, type Plan, type StepUpAction } from '../../lib/jwt.js'
import { prisma } from '../../lib/prisma.js'
import { keys, redis } from '../../lib/redis.js'
import { emailService } from '../../services/email/index.js'
import type { Locale } from '../../services/email/types.js'

// --- Paramètres (app_config, avec les défauts BO-05 en secours) -------------

const DEFAULTS = {
  'security.otp_validity_min': 10,
  'security.otp_max_regen_hr': 5,
  'security.pwd_max_attempts': 5,
  'security.account_lockout_min': 15, // Backend Specs §2.5 — pas de clé BO-05, valeur fixe
} as const

async function configInt(key: keyof typeof DEFAULTS): Promise<number> {
  const row = await prisma().app_config.findUnique({ where: { key }, select: { value: true } })
  const n = row ? Number.parseInt(row.value, 10) : Number.NaN
  return Number.isFinite(n) ? n : DEFAULTS[key]
}

// --- Règles ------------------------------------------------------------------

/** E1-US01 : ≥ 10 caractères, 1 majuscule, 1 chiffre, 1 caractère spécial. */
export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = []
  if (password.length < 10) errors.push('10 caractères minimum')
  if (!/[A-Z]/.test(password)) errors.push('au moins une majuscule')
  if (!/[0-9]/.test(password)) errors.push('au moins un chiffre')
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('au moins un caractère spécial')
  return errors
}

function assertPasswordPolicy(password: string): void {
  const errors = passwordPolicyErrors(password)
  if (errors.length) throw new AppError('VALIDATION_ERROR', { details: { password: errors } })
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Un compte qui n'existe pas doit coûter le même temps qu'un mauvais mot de
// passe : on vérifie contre un hash factice.
let dummyHash: string | undefined
async function equalizeTiming(): Promise<void> {
  dummyHash ??= await hashPassword(randomToken(16))
  await verifyPassword(dummyHash, 'x')
}

// --- Sessions ------------------------------------------------------------------

export interface SessionContext {
  userAgent: string | undefined
  ip: string
}

export interface IssuedSession {
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshMaxAge: number
}

export async function issueSession(userId: string, plan: Plan, ctx: SessionContext): Promise<IssuedSession> {
  const refreshToken = randomToken(32)
  const refreshMaxAge = env().SESSION_DAYS * 86_400
  const session = await prisma().sessions.create({
    data: {
      user_id: userId,
      refresh_token_hash: hmacToken(refreshToken),
      device_info: ctx.userAgent?.slice(0, 200) ?? null,
      ip_hash: sha256Hex(ctx.ip),
      expires_at: new Date(Date.now() + refreshMaxAge * 1000),
    },
    select: { id: true },
  })
  const { token, expiresIn } = await signAccessToken({ sub: userId, plan, sid: session.id })
  return { accessToken: token, expiresIn, refreshToken, refreshMaxAge }
}

/** Rotation : l'ancien refresh token est invalidé, un nouveau est émis. */
export async function refreshSession(refreshToken: string): Promise<IssuedSession> {
  const session = await prisma().sessions.findUnique({
    where: { refresh_token_hash: hmacToken(refreshToken) },
    select: { id: true, expires_at: true, users: { select: { id: true, plan: true, account_status: true, deleted_at: true } } },
  })
  if (!session || session.expires_at.getTime() < Date.now()) throw new AppError('AUTH_TOKEN_EXPIRED')
  if (session.users.deleted_at) throw new AppError('AUTH_TOKEN_INVALID')
  if (session.users.account_status === 'suspended') throw new AppError('AUTH_ACCOUNT_SUSPENDED')

  const next = randomToken(32)
  const refreshMaxAge = env().SESSION_DAYS * 86_400
  await prisma().sessions.update({
    where: { id: session.id },
    data: { refresh_token_hash: hmacToken(next), last_used_at: new Date() },
  })
  const plan: Plan = session.users.plan === 'premium' ? 'premium' : 'free'
  const { token, expiresIn } = await signAccessToken({ sub: session.users.id, plan, sid: session.id })
  return { accessToken: token, expiresIn, refreshToken: next, refreshMaxAge }
}

export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  await prisma().sessions.deleteMany({ where: { id: sessionId, user_id: userId } })
}

export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const r = await prisma().sessions.deleteMany({ where: { user_id: userId, id: { not: keepSessionId } } })
  return r.count
}

// --- OTP email ----------------------------------------------------------------

type OtpPurpose = 'registration' | 'email_change' | 'password_reset'

async function createOtp(email: string, purpose: OtpPurpose, userId: string | null): Promise<{ code: string; minutes: number }> {
  const minutes = await configInt('security.otp_validity_min')
  const code = randomOtp(6)
  // Un seul OTP actif par (email, purpose) : les précédents sont consommés.
  await prisma().email_otp.updateMany({
    where: { email, purpose, used_at: null },
    data: { used_at: new Date() },
  })
  await prisma().email_otp.create({
    data: {
      user_id: userId,
      email,
      otp_hash: hmacToken(code),
      purpose,
      expires_at: new Date(Date.now() + minutes * 60_000),
    },
  })
  return { code, minutes }
}

/**
 * Vérifie et consomme un OTP. Compte les échecs sur la ligne ; à 5 l'OTP est
 * invalidé (email_otp.attempts <= 5 est un CHECK du schéma).
 */
async function consumeOtp(email: string, purpose: OtpPurpose, code: string): Promise<{ userId: string | null }> {
  const otp = await prisma().email_otp.findFirst({
    where: { email, purpose, used_at: null, expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
    select: { id: true, otp_hash: true, attempts: true, user_id: true },
  })
  if (!otp) throw new AppError('AUTH_OTP_INVALID')

  if (safeEqualHex(otp.otp_hash, hmacToken(code))) {
    await prisma().email_otp.update({ where: { id: otp.id }, data: { used_at: new Date() } })
    return { userId: otp.user_id }
  }

  const attempts = otp.attempts + 1
  if (attempts >= 5) {
    await prisma().email_otp.update({ where: { id: otp.id }, data: { attempts, used_at: new Date() } })
    throw new AppError('AUTH_OTP_EXHAUSTED')
  }
  await prisma().email_otp.update({ where: { id: otp.id }, data: { attempts } })
  throw new AppError('AUTH_OTP_INVALID')
}

/** security.otp_max_regen_hr : 5 regénérations / heure / email. */
async function assertOtpRegenAllowed(email: string): Promise<void> {
  const max = await configInt('security.otp_max_regen_hr')
  const key = keys.otpRegen(email)
  const n = await redis().incr(key)
  if (n === 1) await redis().expire(key, 3600)
  if (n > max) throw new AppError('RATE_LIMITED')
}

// --- Inscription (E1-US01) ----------------------------------------------------
//
// « Le compte n'est créé qu'après validation de l'OTP » : les données
// d'inscription attendent dans Redis, l'OTP a user_id NULL. Rien n'existe en
// PostgreSQL tant que l'email n'est pas prouvé — pas de squat d'adresse.

interface PendingRegistration {
  full_name: string
  phone: string
  password_hash: string
  language: Locale
}

const PENDING_TTL_SECONDS = 30 * 60

export async function register(input: {
  full_name: string
  email: string
  phone: string
  password: string
  language?: Locale
}): Promise<void> {
  const email = normalizeEmail(input.email)
  assertPasswordPolicy(input.password)
  const language: Locale = input.language ?? 'fr'

  const existing = await prisma().users.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    // Réponse identique à une inscription valide : on ne révèle pas que
    // l'adresse est prise (E1-US01). Le hash est calculé pour égaliser le temps.
    await hashPassword(input.password)
    return
  }

  const pending: PendingRegistration = {
    full_name: input.full_name.trim(),
    phone: input.phone.trim(),
    password_hash: await hashPassword(input.password),
    language,
  }
  await redis().set(keys.pendingRegistration(email), JSON.stringify(pending), 'EX', PENDING_TTL_SECONDS)

  const { code, minutes } = await createOtp(email, 'registration', null)
  await emailService().send({
    userId: null,
    to: email,
    type: 'otp_registration',
    locale: language,
    params: { name: pending.full_name.split(' ')[0] ?? '', code, minutes: String(minutes) },
  })
}

export async function resendRegistrationOtp(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail)
  const raw = await redis().get(keys.pendingRegistration(email))
  if (!raw) return // rien en attente : réponse générique
  await assertOtpRegenAllowed(email)
  const pending = JSON.parse(raw) as PendingRegistration
  await redis().expire(keys.pendingRegistration(email), PENDING_TTL_SECONDS)
  const { code, minutes } = await createOtp(email, 'registration', null)
  await emailService().send({
    userId: null,
    to: email,
    type: 'otp_registration',
    locale: pending.language,
    params: { name: pending.full_name.split(' ')[0] ?? '', code, minutes: String(minutes) },
  })
}

export async function verifyRegistration(
  rawEmail: string,
  code: string,
  ctx: SessionContext,
): Promise<{ session: IssuedSession; user: PublicUser }> {
  const email = normalizeEmail(rawEmail)
  await consumeOtp(email, 'registration', code)

  const raw = await redis().get(keys.pendingRegistration(email))
  if (!raw) throw new AppError('AUTH_OTP_INVALID', { message: 'Inscription expirée — recommencez.' })
  const pending = JSON.parse(raw) as PendingRegistration

  const user = await prisma().$transaction(async (tx) => {
    const created = await tx.users.create({
      data: {
        email,
        full_name: pending.full_name,
        phone: pending.phone,
        password_hash: pending.password_hash,
        language: pending.language,
        email_verified: true,
        account_status: 'active',
        plan: 'free',
      },
      select: publicUserSelect,
    })
    // Une ligne subscriptions par utilisateur, plan gratuit (BO-07).
    await tx.subscriptions.create({ data: { user_id: created.id, plan: 'free', status: 'active' } })
    return created
  })
  await redis().del(keys.pendingRegistration(email))

  const session = await issueSession(user.id, 'free', ctx)
  return { session, user: toPublicUser(user) }
}

// --- Connexion (§2.2, §2.5) -----------------------------------------------------

const publicUserSelect = {
  id: true,
  email: true,
  full_name: true,
  language: true,
  plan: true,
  totp_enabled: true,
  ed25519_pk: true,
} as const

export interface PublicUser {
  id: string
  email: string
  full_name: string
  language: Locale
  plan: Plan
  totp_enabled: boolean
  has_public_key: boolean
}

function toPublicUser(u: {
  id: string
  email: string
  full_name: string
  language: string
  plan: string
  totp_enabled: boolean
  ed25519_pk: Uint8Array | null
}): PublicUser {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    language: u.language === 'en' ? 'en' : 'fr',
    plan: u.plan === 'premium' ? 'premium' : 'free',
    totp_enabled: u.totp_enabled,
    has_public_key: u.ed25519_pk !== null,
  }
}

export type LoginResult =
  | { kind: 'session'; session: IssuedSession; user: PublicUser }
  | { kind: '2fa'; tempToken: string; expiresIn: number }

const TWO_FACTOR_TEMP_TTL = 5 * 60

export async function login(rawEmail: string, password: string, ctx: SessionContext): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail)
  const user = await prisma().users.findUnique({
    where: { email },
    select: {
      ...publicUserSelect,
      password_hash: true,
      account_status: true,
      deleted_at: true,
      login_fail_count: true,
      login_locked_until: true,
    },
  })

  if (!user || user.deleted_at) {
    await equalizeTiming()
    throw new AppError('AUTH_INVALID_CREDENTIALS')
  }

  if (user.login_locked_until && user.login_locked_until.getTime() > Date.now()) {
    throw new AppError('AUTH_ACCOUNT_LOCKED')
  }

  if (!(await verifyPassword(user.password_hash, password))) {
    await recordLoginFailure(user.id, user.email, user.login_fail_count, toPublicUser(user).language)
    throw new AppError('AUTH_INVALID_CREDENTIALS')
  }

  if (user.account_status === 'suspended') throw new AppError('AUTH_ACCOUNT_SUSPENDED')
  if (user.account_status !== 'active') throw new AppError('AUTH_EMAIL_NOT_VERIFIED')

  if (user.login_fail_count > 0 || user.login_locked_until) {
    await prisma().users.update({ where: { id: user.id }, data: { login_fail_count: 0, login_locked_until: null } })
  }

  const pub = toPublicUser(user)

  if (user.totp_enabled) {
    const tempToken = randomToken(32)
    await redis().set(keys.twoFactorPending(tempToken), user.id, 'EX', TWO_FACTOR_TEMP_TTL)
    return { kind: '2fa', tempToken, expiresIn: TWO_FACTOR_TEMP_TTL }
  }

  return { kind: 'session', session: await issueSession(user.id, pub.plan, ctx), user: pub }
}

async function recordLoginFailure(userId: string, email: string, previous: number, locale: Locale): Promise<void> {
  const max = await configInt('security.pwd_max_attempts')
  const failures = previous + 1
  if (failures >= max) {
    const minutes = DEFAULTS['security.account_lockout_min']
    await prisma().users.update({
      where: { id: userId },
      data: { login_fail_count: 0, login_locked_until: new Date(Date.now() + minutes * 60_000) },
    })
    await emailService().send({ userId, to: email, type: 'account_locked', locale, params: { minutes: String(minutes) } })
    throw new AppError('AUTH_ACCOUNT_LOCKED')
  }
  await prisma().users.update({ where: { id: userId }, data: { login_fail_count: failures } })
}

// --- Step-up (DEC-25) -----------------------------------------------------------

export async function issueStepUp(userId: string, action: StepUpAction) {
  const { token, expiresAt } = await signStepUpToken(userId, action)
  return { step_up_token: token, action, expires_at: expiresAt.toISOString() }
}

// --- Clé publique (DEC-05) ------------------------------------------------------

export async function registerPublicKey(userId: string, pkBase64: string): Promise<void> {
  const pk = decodeBase64(pkBase64)
  if (!pk || pk.length !== ED25519_PK_BYTES) {
    throw new AppError('VALIDATION_ERROR', { details: { ed25519_pk: `${ED25519_PK_BYTES} bytes attendus` } })
  }
  const user = await prisma().users.findUnique({ where: { id: userId }, select: { ed25519_pk: true } })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  if (user.ed25519_pk) throw new AppError('AUTH_KEY_ALREADY_SET')
  // Prisma 6 attend Uint8Array<ArrayBuffer> ; Buffer est typé sur ArrayBufferLike.
  await prisma().users.update({ where: { id: userId }, data: { ed25519_pk: new Uint8Array(pk) } })
}

// --- Mot de passe (E6-US03) -----------------------------------------------------

export async function changePassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ revoked_sessions: number }> {
  assertPasswordPolicy(newPassword)
  const user = await prisma().users.findUnique({
    where: { id: userId },
    select: { email: true, language: true, password_hash: true },
  })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  if (!(await verifyPassword(user.password_hash, currentPassword))) throw new AppError('AUTH_INVALID_CREDENTIALS')

  await prisma().users.update({ where: { id: userId }, data: { password_hash: await hashPassword(newPassword) } })
  const revoked = await revokeOtherSessions(userId, sessionId)
  await emailService().send({ userId, to: user.email, type: 'password_changed', locale: user.language === 'en' ? 'en' : 'fr' })
  return { revoked_sessions: revoked }
}

// --- Restauration par challenge Ed25519 (DEC-06) --------------------------------

const RESTORE_CHALLENGE_TTL_MS = 5 * 60_000

export async function createRestoreChallenge(userId: string): Promise<{ challenge_id: string; challenge: string; expires_at: string }> {
  const user = await prisma().users.findUnique({ where: { id: userId }, select: { ed25519_pk: true } })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  if (!user.ed25519_pk) throw new AppError('AUTH_KEY_NOT_SET')

  const challenge = new Uint8Array(randomBytes(32))
  const row = await prisma().restore_challenges.create({
    data: { user_id: userId, challenge, expires_at: new Date(Date.now() + RESTORE_CHALLENGE_TTL_MS) },
    select: { id: true, expires_at: true },
  })
  return { challenge_id: row.id, challenge: Buffer.from(challenge).toString('base64'), expires_at: row.expires_at.toISOString() }
}

/**
 * Un challenge se consomme à la première tentative, bonne ou mauvaise : une
 * mauvaise signature le brûle. Rate-limité par IP en amont.
 */
export async function verifyRestoreChallenge(userId: string, challengeId: string, signatureBase64: string): Promise<void> {
  const row = await prisma().restore_challenges.findFirst({
    where: { id: challengeId, user_id: userId, used: false, expires_at: { gt: new Date() } },
    select: { id: true, challenge: true, users: { select: { email: true, language: true, ed25519_pk: true } } },
  })
  if (!row) throw new AppError('AUTH_RESTORE_FAILED', { message: 'Challenge invalide ou expiré.' })
  await prisma().restore_challenges.update({ where: { id: row.id }, data: { used: true } })

  const pk = row.users.ed25519_pk
  const sig = decodeBase64(signatureBase64)
  if (!pk || !sig || !ed25519Verify(Buffer.from(pk), Buffer.from(row.challenge), sig)) {
    throw new AppError('AUTH_RESTORE_FAILED')
  }

  await emailService().send({
    userId,
    to: row.users.email,
    type: 'restore_succeeded',
    locale: row.users.language === 'en' ? 'en' : 'fr',
  })
}

// --- Réinitialisation du mot de passe (E1-US05) --------------------------------
//
// « Réinitialisation via email + 12 mots » : l'OTP prouve l'email, une
// signature Ed25519 prouve le seed. Le message signé est déterministe et lié
// à l'OTP (usage unique), ce qui évite un troisième endpoint :
//
//   message = "relais:password-reset:v1:" + email + ":" + code

export function passwordResetMessage(email: string, code: string): Buffer {
  return Buffer.from(`relais:password-reset:v1:${email}:${code}`, 'utf8')
}

export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail)
  const user = await prisma().users.findUnique({
    where: { email },
    select: { id: true, language: true, account_status: true, deleted_at: true },
  })
  if (!user || user.deleted_at || user.account_status !== 'active') return // générique
  await assertOtpRegenAllowed(email)
  const { code, minutes } = await createOtp(email, 'password_reset', user.id)
  await emailService().send({
    userId: user.id,
    to: email,
    type: 'otp_password_reset',
    locale: user.language === 'en' ? 'en' : 'fr',
    params: { code, minutes: String(minutes) },
  })
}

export async function resetPassword(input: {
  email: string
  code: string
  new_password: string
  signature?: string
}): Promise<void> {
  const email = normalizeEmail(input.email)
  assertPasswordPolicy(input.new_password)

  const user = await prisma().users.findUnique({
    where: { email },
    select: { id: true, language: true, ed25519_pk: true },
  })
  if (!user) throw new AppError('AUTH_OTP_INVALID')

  // Si le compte a une clé, la signature est obligatoire et vérifiée AVANT de
  // consommer l'OTP : un attaquant avec accès à la boîte mail mais sans le
  // seed ne doit pas pouvoir brûler l'OTP du propriétaire.
  if (user.ed25519_pk) {
    const sig = input.signature ? decodeBase64(input.signature) : null
    if (!sig || !ed25519Verify(Buffer.from(user.ed25519_pk), passwordResetMessage(email, input.code), sig)) {
      throw new AppError('AUTH_RESTORE_FAILED')
    }
  }

  await consumeOtp(email, 'password_reset', input.code)

  await prisma().users.update({
    where: { id: user.id },
    data: { password_hash: await hashPassword(input.new_password), login_fail_count: 0, login_locked_until: null },
  })
  await prisma().sessions.deleteMany({ where: { user_id: user.id } })
  await emailService().send({ userId: user.id, to: email, type: 'password_changed', locale: user.language === 'en' ? 'en' : 'fr' })
}

// --- 2FA TOTP (E6-US02) ---------------------------------------------------------

const TOTP_SETUP_TTL = 10 * 60

function totp(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({ issuer: 'Relais', label, algorithm: 'SHA1', digits: 6, period: 30, secret })
}

export async function setupTwoFactor(userId: string): Promise<{ secret: string; otpauth_uri: string }> {
  const user = await prisma().users.findUnique({ where: { id: userId }, select: { email: true, totp_enabled: true } })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  if (user.totp_enabled) throw new AppError('VALIDATION_ERROR', { message: 'La double authentification est déjà active.' })
  const secret = new OTPAuth.Secret({ size: 20 }).base32
  await redis().set(keys.twoFactorSetup(userId), secret, 'EX', TOTP_SETUP_TTL)
  return { secret, otpauth_uri: totp(secret, user.email).toString() }
}

/** Activation : le code prouve que l'app d'authentification est bien configurée. */
export async function activateTwoFactor(userId: string, code: string): Promise<void> {
  const secret = await redis().get(keys.twoFactorSetup(userId))
  if (!secret) throw new AppError('AUTH_2FA_INVALID', { message: 'Configuration expirée — relancez la mise en place.' })
  const user = await prisma().users.findUnique({ where: { id: userId }, select: { email: true, language: true } })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  if (totp(secret, user.email).validate({ token: code, window: 1 }) === null) throw new AppError('AUTH_2FA_INVALID')

  await prisma().users.update({ where: { id: userId }, data: { totp_secret: secret, totp_enabled: true } })
  await redis().del(keys.twoFactorSetup(userId))
  await emailService().send({ userId, to: user.email, type: 'two_factor_enabled', locale: user.language === 'en' ? 'en' : 'fr' })
}

/** Connexion : le temp_token du login + un code valide donnent une session. */
export async function completeTwoFactorLogin(
  tempToken: string,
  code: string,
  ctx: SessionContext,
): Promise<{ session: IssuedSession; user: PublicUser }> {
  const key = keys.twoFactorPending(tempToken)
  const userId = await redis().get(key)
  if (!userId) throw new AppError('AUTH_TOKEN_EXPIRED')
  const user = await prisma().users.findUnique({
    where: { id: userId },
    select: { ...publicUserSelect, totp_secret: true },
  })
  if (!user?.totp_secret || !user.totp_enabled) throw new AppError('AUTH_2FA_INVALID')
  if (totp(user.totp_secret, user.email).validate({ token: code, window: 1 }) === null) throw new AppError('AUTH_2FA_INVALID')
  await redis().del(key)
  const pub = toPublicUser(user)
  return { session: await issueSession(user.id, pub.plan, ctx), user: pub }
}

export async function disableTwoFactor(userId: string, code: string): Promise<void> {
  const user = await prisma().users.findUnique({
    where: { id: userId },
    select: { email: true, language: true, totp_secret: true, totp_enabled: true },
  })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  if (!user.totp_enabled || !user.totp_secret) throw new AppError('VALIDATION_ERROR', { message: 'La double authentification n’est pas active.' })
  if (totp(user.totp_secret, user.email).validate({ token: code, window: 1 }) === null) throw new AppError('AUTH_2FA_INVALID')

  await prisma().users.update({ where: { id: userId }, data: { totp_secret: null, totp_enabled: false } })
  await emailService().send({ userId, to: user.email, type: 'two_factor_disabled', locale: user.language === 'en' ? 'en' : 'fr' })
}

export async function currentUser(userId: string): Promise<PublicUser> {
  const user = await prisma().users.findUnique({ where: { id: userId }, select: publicUserSelect })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  return toPublicUser(user)
}
