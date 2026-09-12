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

/**
 * TRUST_PROXY (audit HIGH-4) : X-Forwarded-For n'est cru qu'en connaissance
 * de cause. Faux par défaut ; en production, le nombre de sauts (1 derrière
 * un seul reverse proxy) ou la liste des IP du proxy. Sinon n'importe quel
 * client choisit son IP et contourne toutes les limites de débit.
 */
export type TrustProxy = boolean | string | ((address: string, hop: number) => boolean)

export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = raw?.trim()
  if (!value || value === 'false') return false
  if (value === 'true') return true
  if (/^\d+$/.test(value)) {
    // Nombre de sauts de confiance, comme proxy-addr le compte (0 = le client direct).
    const hops = Number(value)
    return (_address, hop) => hop < hops
  }
  // Une liste d'IP ou de plages, telle que Fastify (proxy-addr) la lit : séparées par des virgules.
  return value.split(',').map((s) => s.trim()).filter(Boolean).join(',')
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Démarre le worker BullMQ (deadman:checkin) dans ce processus. */
  JOBS_ENABLED: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Voir parseTrustProxy : 'false' (défaut), 'true', un nombre de sauts, ou des IP séparées par des virgules. */
  TRUST_PROXY: z.string().optional(),
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

  // relais_x25519_sk (DEC-15/28/30, Backend v1.1 §9.1) : clé privée X25519 de
  // Relais, 32 bytes. Ouvre les sealed boxes notification_enc des contacts.
  // En production elle vient de HCV Secrets Engine (KV v2) — obligatoire ;
  // en dev/test d'une variable d'env. Lue uniquement par services/secrets.
  HCV_ADDR: z.string().url().optional(),
  HCV_TOKEN: z.string().min(1).optional(),
  /** Chemin KV v2 après /v1/ — le secret 'relais/x25519_sk' du moteur 'secret'. */
  HCV_SECRET_PATH: z.string().min(1).default('secret/data/relais/x25519_sk'),
  HCV_SECRET_FIELD: z.string().min(1).default('x25519_sk'),
  RELAIS_X25519_SK_DEV: z
    .string()
    .regex(/^(?:[0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=)$/, 'RELAIS_X25519_SK_DEV : 32 bytes en hex ou base64')
    .optional(),

  // Push OneSignal (lot 5 mobile, docs/mobile.md §3) : clé REST dans l'env (DEC-18).
  PUSH_TRANSPORT: z.enum(['console', 'onesignal']).default('console'),
  ONESIGNAL_APP_ID: z.string().min(1).optional(),
  ONESIGNAL_REST_API_KEY: z.string().min(1).optional(),
  ONESIGNAL_API_URL: z.string().url().default('https://api.onesignal.com'),

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
  .refine((e) => e.PUSH_TRANSPORT !== 'onesignal' || (Boolean(e.ONESIGNAL_APP_ID) && Boolean(e.ONESIGNAL_REST_API_KEY)), {
    message: 'ONESIGNAL_APP_ID et ONESIGNAL_REST_API_KEY sont requis quand PUSH_TRANSPORT=onesignal',
  })
  .refine((e) => e.STORAGE_BACKEND !== 's3' || (Boolean(e.STORJ_ACCESS_KEY) && Boolean(e.STORJ_SECRET_KEY)), {
    message: 'STORJ_ACCESS_KEY et STORJ_SECRET_KEY sont requis quand STORAGE_BACKEND=s3',
  })
  .refine((e) => !e.HCV_ADDR === !e.HCV_TOKEN, {
    message: 'HCV_ADDR et HCV_TOKEN vont ensemble',
  })
  .refine((e) => e.NODE_ENV !== 'production' || Boolean(e.HCV_ADDR), {
    message: 'HCV_ADDR et HCV_TOKEN sont requis en production : relais_x25519_sk vit dans HCV (DEC-15, DEC-30)',
  })
  .refine((e) => e.NODE_ENV !== 'production' || !e.RELAIS_X25519_SK_DEV, {
    message: 'RELAIS_X25519_SK_DEV est interdit en production',
  })
  .refine((e) => Boolean(e.HCV_ADDR) || Boolean(e.RELAIS_X25519_SK_DEV), {
    message: 'RELAIS_X25519_SK_DEV est requis hors production (ou HCV_ADDR + HCV_TOKEN)',
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
