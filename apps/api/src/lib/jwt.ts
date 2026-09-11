// Deux JWT distincts, deux secrets distincts (Backend Specs §2.1, §2.5, DEC-25).
//
//   access token  : 15 min, { sub, plan }        — autorise les requêtes API
//   step-up token : 5 min,  { sub, action, jti } — prouve qu'un PIN a été
//                   validé localement pour UNE action précise, usage unique
//
// Aucun des deux ne contient de donnée sensible. K1/K2/K3, PIN, seed ne
// transitent jamais dans un token.

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import { randomUUID } from 'node:crypto'
import { env, durationToSeconds } from '../config/env.js'
import { AppError } from './errors.js'

const ISSUER = 'relais-api'

export type Plan = 'free' | 'premium'

export const STEP_UP_ACTIONS = [
  'edit_transmission',
  'activate_transmission',
  'delete_transmission',
  'edit_contacts',
  'change_password',
  'view_seed',
  'disable_2fa',
  'admin_action',
] as const
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number]

export function isStepUpAction(value: unknown): value is StepUpAction {
  return typeof value === 'string' && (STEP_UP_ACTIONS as readonly string[]).includes(value)
}

export interface AccessClaims {
  sub: string
  plan: Plan
  /**
   * Identifiant de la session (ligne `sessions`). Le cookie refresh est
   * limité à Path=/auth/refresh (§7.2) : /auth/logout ne le reçoit jamais.
   * C'est donc l'access token qui dit quelle session révoquer.
   */
  sid: string
}

/** Token du back office : audience distincte, 8 h, session Redis révocable. */
export interface AdminClaims {
  sub: string
  role: string
  sid: string
}

export const ADMIN_TOKEN_SECONDS = 8 * 3600

export async function signAdminToken(claims: AdminClaims): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({ role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience('admin')
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_TOKEN_SECONDS}s`)
    .sign(secret('access'))
  return { token, expiresIn: ADMIN_TOKEN_SECONDS }
}

export async function verifyAdminToken(token: string): Promise<AdminClaims> {
  try {
    const { payload } = await jwtVerify(token, secret('access'), { issuer: ISSUER, audience: 'admin' })
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.role !== 'string') {
      throw new AppError('AUTH_TOKEN_INVALID')
    }
    return { sub: payload.sub, role: payload.role, sid: payload.sid }
  } catch (err) {
    if (err instanceof AppError) throw err
    if (err instanceof joseErrors.JWTExpired) throw new AppError('AUTH_TOKEN_EXPIRED')
    throw new AppError('AUTH_TOKEN_INVALID')
  }
}

export interface StepUpClaims {
  sub: string
  action: StepUpAction
  jti: string
}

function secret(name: 'access' | 'stepup'): Uint8Array {
  return new TextEncoder().encode(name === 'access' ? env().JWT_ACCESS_SECRET : env().JWT_STEPUP_SECRET)
}

export async function signAccessToken(claims: AccessClaims): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = durationToSeconds(env().JWT_ACCESS_EXPIRY)
  const token = await new SignJWT({ plan: claims.plan, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience('access')
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret('access'))
  return { token, expiresIn }
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret('access'), { issuer: ISSUER, audience: 'access' })
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      (payload.plan !== 'free' && payload.plan !== 'premium')
    ) {
      throw new AppError('AUTH_TOKEN_INVALID')
    }
    return { sub: payload.sub, plan: payload.plan, sid: payload.sid }
  } catch (err) {
    if (err instanceof AppError) throw err
    if (err instanceof joseErrors.JWTExpired) throw new AppError('AUTH_TOKEN_EXPIRED')
    throw new AppError('AUTH_TOKEN_INVALID')
  }
}

export async function signStepUpToken(
  sub: string,
  action: StepUpAction,
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const ttl = durationToSeconds(env().JWT_STEPUP_EXPIRY)
  const jti = randomUUID()
  const expiresAt = new Date(Date.now() + ttl * 1000)
  const token = await new SignJWT({ action })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setJti(jti)
    .setIssuer(ISSUER)
    .setAudience('step-up')
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret('stepup'))
  return { token, jti, expiresAt }
}

/**
 * Vérifie signature, expiration et cohérence des claims. NE vérifie PAS
 * l'usage unique : c'est requireStepUp qui consulte Redis, parce que la
 * consommation du jti doit être atomique avec l'autorisation.
 */
export async function verifyStepUpToken(token: string): Promise<StepUpClaims & { exp: number }> {
  try {
    const { payload } = await jwtVerify(token, secret('stepup'), { issuer: ISSUER, audience: 'step-up' })
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.exp !== 'number' ||
      !isStepUpAction(payload.action)
    ) {
      throw new AppError('AUTH_STEPUP_INVALID')
    }
    return { sub: payload.sub, jti: payload.jti, action: payload.action, exp: payload.exp }
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError('AUTH_STEPUP_INVALID')
  }
}
