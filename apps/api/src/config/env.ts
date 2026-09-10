// Configuration par variables d'environnement (Backend Specs §8, DEC-18).
// Validée au démarrage : une variable manquante ou malformée fait échouer le
// boot plutôt que de laisser tourner un serveur mal configuré.

import { z } from 'zod'

const durationRe = /^(\d+)(s|m|h|d)$/

/** '15m' → 900 secondes. */
export function durationToSeconds(value: string): number {
  const m = durationRe.exec(value)
  if (!m) throw new Error(`Durée invalide : ${value}`)
  const n = Number(m[1])
  switch (m[2]) {
    case 's':
      return n
    case 'm':
      return n * 60
    case 'h':
      return n * 3600
    default:
      return n * 86_400
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET : 32 caractères minimum'),
  JWT_STEPUP_SECRET: z.string().min(32, 'JWT_STEPUP_SECRET : 32 caractères minimum'),
  JWT_ACCESS_EXPIRY: z.string().regex(durationRe).default('15m'),
  JWT_STEPUP_EXPIRY: z.string().regex(durationRe).default('5m'),
  SESSION_DAYS: z.coerce.number().int().positive().default(90),
  TOKEN_HMAC_SECRET: z.string().min(32, 'TOKEN_HMAC_SECRET : 32 caractères minimum'),

  EMAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Relais <noreply@relais.app>'),
  EMAIL_REPLY_TO: z.string().default('support@relais.app'),
})
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_STEPUP_SECRET, {
    message: 'JWT_STEPUP_SECRET doit être différent de JWT_ACCESS_SECRET (Backend Specs §2.5)',
  })
  .refine((e) => e.EMAIL_TRANSPORT !== 'resend' || Boolean(e.RESEND_API_KEY), {
    message: 'RESEND_API_KEY est requis quand EMAIL_TRANSPORT=resend',
  })

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(global)'} : ${i.message}`)
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`)
  }
  return parsed.data
}

let cached: Env | undefined

export function env(): Env {
  if (!cached) cached = loadEnv()
  return cached
}

/** Pour les tests : remplacer l'environnement chargé. */
export function setEnvForTests(e: Env): void {
  cached = e
}
