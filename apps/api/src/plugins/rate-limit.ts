// Rate limiting sur Redis (Backend Specs §7.1).
//
// Global : 200 req / min par utilisateur authentifié, sinon par IP.
// Par route : `config: { rateLimit: limits.xxx }` sur la définition de route.

import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { redis } from '../lib/redis.js'

function keyByUserOrIp(req: FastifyRequest): string {
  return req.user ? `u:${req.user.id}` : `ip:${req.ip}`
}

export const limits = {
  /** POST /auth/login — 10 / 15 min / IP */
  login: { max: 10, timeWindow: '15 minutes', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** POST /auth/register — 5 / 1 h / IP */
  register: { max: 5, timeWindow: '1 hour', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** POST /auth/email/verify — 10 / 1 h / user (ici : par email, l'user n'existe pas encore) */
  emailVerify: {
    max: 10,
    timeWindow: '1 hour',
    keyGenerator: (r: FastifyRequest) => `email:${(r.body as { email?: string })?.email?.toLowerCase() ?? r.ip}`,
  },
  /** POST /auth/email/resend-otp — 5 / 1 h / email */
  resendOtp: {
    max: 5,
    timeWindow: '1 hour',
    keyGenerator: (r: FastifyRequest) => `email:${(r.body as { email?: string })?.email?.toLowerCase() ?? r.ip}`,
  },
  /** POST /auth/2fa/verify — 10 / 15 min / IP */
  twoFactorVerify: { max: 10, timeWindow: '15 minutes', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** POST /auth/pin/step-up — 10 / min / user (DEC-25) */
  stepUp: { max: 10, timeWindow: '1 minute', keyGenerator: keyByUserOrIp },
  /** Restauration — 10 / 15 min / IP : chaque essai coûte un challenge */
  restore: { max: 10, timeWindow: '15 minutes', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** GET + PUT /vault/* — 60 / min / user */
  vault: { max: 60, timeWindow: '1 minute', keyGenerator: keyByUserOrIp },
  /** POST /vault/sync — 10 / h / user */
  vaultSync: { max: 10, timeWindow: '1 hour', keyGenerator: keyByUserOrIp },
  /** POST /checkin/game/answer — 10 / h / user (§7.1) */
  checkinAnswer: { max: 10, timeWindow: '1 hour', keyGenerator: keyByUserOrIp },
  /** GET /transmission/relais-key — 60 / min / IP, public (DEC-28) */
  relaisKey: { max: 60, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** GET /relay/:token/* — lecture côté contact, 30 / min / IP (public) */
  relayRead: { max: 30, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** POST /relay/:token/* — 3 / min / IP (§7.1) */
  relayWrite: { max: 3, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** POST /admin/auth/login — 5 / 15 min / IP (§7.1) */
  adminLogin: { max: 5, timeWindow: '15 minutes', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
  /** GET /admin/* — 120 / min / admin (§7.1) */
  admin: { max: 120, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => (r.admin ? `adm:${r.admin.id}` : `ip:${r.ip}`) },
  /** GET /health — 60 / min / IP (§9.2) */
  health: { max: 60, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` },
} as const

export const rateLimitPlugin = fp(async (app: FastifyInstance) => {
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: keyByUserOrIp,
    redis: redis(),
    nameSpace: 'rl:',
    // La réponse 429 est mise en forme par le plugin envelope.
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  })
})
