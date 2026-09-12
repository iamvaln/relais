// Back office — authentification (Backend Specs §3.8, Back Office Specs).

import { ADMIN_TOKEN_SECONDS, signAdminToken } from '../../lib/jwt.js'
import { audit } from '../../lib/audit.js'
import { hashPassword, randomToken, verifyPassword } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { keys, redis } from '../../lib/redis.js'
import { decryptTotpSecret, verifyTotpOnce } from '../../lib/totp.js'
import { normalizeEmail } from '../auth/service.js'

const MAX_LOGIN_FAILURES = 5
const LOCK_MINUTES = 15

export interface AdminView {
  id: string
  email: string
  full_name: string
  role: string
}

export interface AdminLoginResult {
  access_token: string
  expires_in: number
  admin: AdminView
}

export interface RequestContext {
  ip: string
  userAgent?: string
}

let dummyHash: string | undefined
/** Même coût qu'une vérification réelle quand l'email est inconnu (pas d'oracle temporel). */
async function equalize(password: string): Promise<void> {
  dummyHash ??= await hashPassword('relais-admin-dummy-Password-1!')
  await verifyPassword(dummyHash, password)
}

/** Audit LOW-14 : secret déchiffré à la volée, pas consommé (un code ne sert qu'une fois). */
function totpValid(adminId: string, secret: string, code: string): Promise<boolean> {
  return verifyTotpOnce(`a:${adminId}`, decryptTotpSecret(secret), code)
}

async function recordFailure(id: string, previous: number): Promise<void> {
  const count = previous + 1
  await prisma().admin_users.update({
    where: { id },
    data: {
      login_fail_count: count,
      login_locked_until: count >= MAX_LOGIN_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
    },
  })
}

export async function login(email: string, password: string, code: string, ctx: RequestContext): Promise<AdminLoginResult> {
  const admin = await prisma().admin_users.findUnique({ where: { email: normalizeEmail(email) } })
  if (!admin) {
    await equalize(password)
    throw new AppError('AUTH_INVALID_CREDENTIALS')
  }
  if (admin.login_locked_until && admin.login_locked_until > new Date()) throw new AppError('AUTH_ACCOUNT_LOCKED')
  if (admin.status !== 'active') throw new AppError('AUTH_ACCOUNT_SUSPENDED')

  // Mot de passe et TOTP vérifiés ensemble : la réponse ne dit pas lequel manque.
  const passwordOk = await verifyPassword(admin.password_hash, password)
  const totpOk = admin.totp_enabled && admin.totp_secret !== null && (await totpValid(admin.id, admin.totp_secret, code))
  if (!passwordOk || !totpOk) {
    await recordFailure(admin.id, admin.login_fail_count)
    throw new AppError('AUTH_INVALID_CREDENTIALS')
  }

  const sid = randomToken(24)
  await redis().set(keys.adminSession(sid), admin.id, 'EX', ADMIN_TOKEN_SECONDS)
  const { token, expiresIn } = await signAdminToken({ sub: admin.id, role: admin.role, sid })
  await prisma().admin_users.update({
    where: { id: admin.id },
    data: { login_fail_count: 0, login_locked_until: null, last_login_at: new Date() },
  })
  await audit({ adminId: admin.id, action: 'ADMIN_LOGIN', targetType: 'admin', targetId: admin.id, ip: ctx.ip, ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}) })
  return { access_token: token, expires_in: expiresIn, admin: toView(admin) }
}

export async function logout(sid: string): Promise<void> {
  await redis().del(keys.adminSession(sid))
}

function toView(a: { id: string; email: string; full_name: string; role: string }): AdminView {
  return { id: a.id, email: a.email, full_name: a.full_name, role: a.role }
}

export async function me(adminId: string): Promise<AdminView> {
  const a = await prisma().admin_users.findUniqueOrThrow({ where: { id: adminId }, select: { id: true, email: true, full_name: true, role: true } })
  return toView(a)
}
