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

  // Stockage objet des blobs chiffrés (P2, Si_enc) — Backend Specs §5.2.
  //   memory : tests ; fs : dev local ; s3 : Storj (S3-compatible) en prod
  STORAGE_BACKEND: z.enum(['memory', 'fs', 's3']).default('fs'),
  STORAGE_FS_DIR: z.string().default('.storage'),
  STORJ_ENDPOINT: z.string().url().default('https://gateway.storjshare.io'),
  STORJ_ACCESS_KEY: z.string().optional(),
  STORJ_SECRET_KEY: z.string().optional(),
  STORJ_BUCKET: z.string().default('relais-payloads'),

  // Clé privée X25519 de Relais (32 bytes base64) — ouvre les sealed boxes
  // notification_enc des contacts (DEC-12). En production, HCV Secrets Engine
  // (DEC-15) la fournira ; d'ici là, variable d'env derrière services/secrets.
  RELAIS_PRIVATE_KEY: z.string().min(40, 'RELAIS_PRIVATE_KEY : 32 bytes base64'),

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
  .refine((e) => e.STORAGE_BACKEND !== 's3' || (Boolean(e.STORJ_ACCESS_KEY) && Boolean(e.STORJ_SECRET_KEY)), {
    message: 'STORJ_ACCESS_KEY et STORJ_SECRET_KEY sont requis quand STORAGE_BACKEND=s3',
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
