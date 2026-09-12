// services/secrets : la clé privée X25519 vient de HCV (Backend v1.1 §9.1,
// DEC-15/17/30) quand HCV_ADDR est configuré — obligatoire en production —
// et de RELAIS_X25519_SK_DEV ailleurs. Le faux HCV est un serveur HTTP local.

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sodium from '../src/lib/sodium.js'
import { env, loadEnv, setEnvForTests } from '../src/config/env.js'
import { fetchHcvSecret, relaisPublicKeyBase64, resetSecretsForTests } from '../src/services/secrets/index.js'
import { healthReport } from '../src/api/health/routes.js'

const BASE = { ...process.env, RELAIS_X25519_SK_DEV: undefined, HCV_ADDR: undefined, HCV_TOKEN: undefined, ADMIN_URL: undefined }
const KEY_HEX = Buffer.alloc(32, 9).toString('hex')
const TOKEN = 'hvs.test-token'

describe('configuration de la clé privée', () => {
  it('production : HCV_ADDR et HCV_TOKEN requis, RELAIS_X25519_SK_DEV interdit', () => {
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(/HCV_ADDR/)
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'production', HCV_ADDR: 'https://vault.example.com', HCV_TOKEN: TOKEN, RELAIS_X25519_SK_DEV: KEY_HEX })).toThrow(/RELAIS_X25519_SK_DEV/)
    // Audit MEDIUM-8 : la production exige aussi resend, s3 et des URL https
    const PROD = { EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x', STORAGE_BACKEND: 's3', STORJ_ACCESS_KEY: 'k', STORJ_SECRET_KEY: 's', FRONTEND_URL: 'https://app.getrelais.app', APP_URL: 'https://api.getrelais.app' }
    const ok = loadEnv({ ...BASE, ...PROD, NODE_ENV: 'production', HCV_ADDR: 'https://vault.example.com', HCV_TOKEN: TOKEN })
    expect(ok.HCV_SECRET_PATH).toBe('secret/data/relais/x25519_sk')
  })

  it('hors production : RELAIS_X25519_SK_DEV ou HCV, pas rien', () => {
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'development' })).toThrow(/RELAIS_X25519_SK_DEV/)
    expect(loadEnv({ ...BASE, NODE_ENV: 'development', RELAIS_X25519_SK_DEV: KEY_HEX }).RELAIS_X25519_SK_DEV).toBe(KEY_HEX)
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'development', RELAIS_X25519_SK_DEV: 'pas-une-clé' })).toThrow(/RELAIS_X25519_SK_DEV/)
  })
})

describe('HCV KV v2', () => {
  let server: Server
  let addr: string
  const requests: { path: string; token: string | undefined }[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/v1/sys/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ initialized: true, sealed: false }))
      }
      requests.push({ path: req.url ?? '', token: req.headers['x-vault-token'] as string | undefined })
      if (req.headers['x-vault-token'] !== TOKEN) {
        res.writeHead(403, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ errors: ['permission denied'] }))
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: { data: { x25519_sk: KEY_HEX }, metadata: { version: 1 } } }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const a = server.address()
    if (!a || typeof a === 'string') throw new Error('adresse')
    addr = `http://127.0.0.1:${a.port}`
  })
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('lit le champ du secret à /v1/<path> avec X-Vault-Token', async () => {
    const value = await fetchHcvSecret({ addr, token: TOKEN, path: 'secret/data/relais/x25519_sk', field: 'x25519_sk' })
    expect(value).toBe(KEY_HEX)
    expect(requests.at(-1)).toEqual({ path: '/v1/secret/data/relais/x25519_sk', token: TOKEN })
  })

  it('refus HCV ou champ absent → erreur explicite, jamais de repli sur une clé de dev', async () => {
    await expect(fetchHcvSecret({ addr, token: 'mauvais', path: 'secret/data/relais/x25519_sk', field: 'x25519_sk' })).rejects.toThrow(/HCV.*403/)
    await expect(fetchHcvSecret({ addr, token: TOKEN, path: 'secret/data/relais/x25519_sk', field: 'autre' })).rejects.toThrow(/autre/)
  })

  it('/health sonde HCV (sys/health) quand il est configuré : ok, down, sinon unconfigured (BO-01 « HCV indisponible »)', async () => {
    const before = env()
    try {
      expect((await healthReport()).services.hcv).toBe('unconfigured')
      setEnvForTests({ ...before, HCV_ADDR: addr, HCV_TOKEN: TOKEN })
      expect((await healthReport()).services.hcv).toBe('ok')
      setEnvForTests({ ...before, HCV_ADDR: 'http://127.0.0.1:1', HCV_TOKEN: TOKEN })
      expect((await healthReport()).services.hcv).toBe('down')
    } finally {
      setEnvForTests(before)
    }
  })

  it('services/secrets prend la clé dans HCV quand HCV_ADDR est configuré', async () => {
    const before = env()
    setEnvForTests({ ...before, HCV_ADDR: addr, HCV_TOKEN: TOKEN, RELAIS_X25519_SK_DEV: undefined })
    resetSecretsForTests()
    try {
      await sodium.ready
      const expected = Buffer.from(sodium.crypto_scalarmult_base(new Uint8Array(Buffer.from(KEY_HEX, 'hex')))).toString('base64')
      expect(await relaisPublicKeyBase64()).toBe(expected)
    } finally {
      setEnvForTests(before)
      resetSecretsForTests()
    }
  })
})
