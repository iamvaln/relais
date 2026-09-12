// En-têtes HTTP, CORS et cookies (Backend Specs §7.2).

import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { env } from '../config/env.js'

export const REFRESH_COOKIE = 'refresh_token'
export const REFRESH_COOKIE_PATH = '/auth/refresh'

export function refreshCookieOptions(maxAgeSeconds: number) {
  return {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: maxAgeSeconds,
  }
}

export const securityPlugin = fp(async (app: FastifyInstance) => {
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xXssProtection: true,
    noSniff: true,
  })

  // Deux origines navigateur : la page du contact et le back office (lot 1 du back office).
  const origins = [env().FRONTEND_URL, env().ADMIN_URL].filter((o): o is string => Boolean(o))
  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Step-Up-Token'],
    // Le nom du fichier de l'export CSV (BO-07), sinon invisible en cross-origin.
    exposedHeaders: ['Content-Disposition'],
  })

  await app.register(cookie)
})
