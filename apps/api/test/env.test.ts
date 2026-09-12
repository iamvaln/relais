// TRUST_PROXY (audit HIGH-4) : faux par défaut — X-Forwarded-For n'est cru
// qu'en production derrière un proxy connu, par nombre de sauts ou liste d'IP.

import { describe, expect, it } from 'vitest'
import { loadEnv, parseTrustProxy } from '../src/config/env.js'

describe('parseTrustProxy', () => {
  it('absent ou false → false ; true → true ; un entier → nombre de sauts ; une liste → IP du proxy', () => {
    expect(parseTrustProxy(undefined)).toBe(false)
    expect(parseTrustProxy('false')).toBe(false)
    expect(parseTrustProxy('true')).toBe(true)
    const one = parseTrustProxy('1')
    if (typeof one !== 'function') throw new Error('un nombre de sauts devient une fonction')
    expect([one('10.0.0.1', 0), one('10.0.0.1', 1)]).toEqual([true, false])
    const two = parseTrustProxy('2')
    if (typeof two !== 'function') throw new Error('un nombre de sauts devient une fonction')
    expect([two('x', 0), two('x', 1), two('x', 2)]).toEqual([true, true, false])
    expect(parseTrustProxy('10.0.0.1, 10.0.0.2')).toBe('10.0.0.1,10.0.0.2')
    expect(parseTrustProxy('loopback')).toBe('loopback')
  })
})

describe('audit MEDIUM-8 : garde-fous de configuration en production', () => {
  const prod: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://relais@db/relais',
    REDIS_URL: 'redis://redis:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_STEPUP_SECRET: 'b'.repeat(40),
    TOKEN_HMAC_SECRET: 'c'.repeat(40),
    TOTP_ENC_KEY: 'd'.repeat(40),
    HCV_ADDR: 'https://vault.example',
    HCV_TOKEN: 'hvs.x',
    EMAIL_TRANSPORT: 'resend',
    RESEND_API_KEY: 're_x',
    STORAGE_BACKEND: 's3',
    STORJ_ACCESS_KEY: 'k',
    STORJ_SECRET_KEY: 's',
    FRONTEND_URL: 'https://app.getrelais.app',
    APP_URL: 'https://api.getrelais.app',
  }

  it('une configuration de production complète passe', () => {
    expect(loadEnv(prod).NODE_ENV).toBe('production')
  })

  it('ADMIN_URL (back office) est facultative, mais en https en production quand elle est posée', () => {
    expect(loadEnv({ ...prod, ADMIN_URL: undefined }).ADMIN_URL).toBeUndefined()
    expect(loadEnv({ ...prod, ADMIN_URL: 'https://admin.getrelais.app' }).ADMIN_URL).toBe('https://admin.getrelais.app')
    expect(() => loadEnv({ ...prod, ADMIN_URL: 'http://admin.getrelais.app' })).toThrow(/ADMIN_URL/)
  })

  it('audit LOW-14b : TOTP_ENC_KEY est obligatoire, 32 caractères minimum, distinct des secrets JWT', () => {
    expect(() => loadEnv({ ...prod, TOTP_ENC_KEY: undefined })).toThrow(/TOTP_ENC_KEY/)
    expect(() => loadEnv({ ...prod, TOTP_ENC_KEY: 'court' })).toThrow(/TOTP_ENC_KEY/)
    expect(() => loadEnv({ ...prod, TOTP_ENC_KEY: prod.JWT_ACCESS_SECRET })).toThrow(/TOTP_ENC_KEY/)
  })

  it('en production : transport email console, stockage fs ou local, URL en http → refus au démarrage', () => {
    expect(() => loadEnv({ ...prod, EMAIL_TRANSPORT: 'console', RESEND_API_KEY: undefined })).toThrow(/EMAIL_TRANSPORT/)
    expect(() => loadEnv({ ...prod, STORAGE_BACKEND: 'fs', STORJ_ACCESS_KEY: undefined, STORJ_SECRET_KEY: undefined })).toThrow(/STORAGE_BACKEND/)
    expect(() => loadEnv({ ...prod, FRONTEND_URL: 'http://app.getrelais.app' })).toThrow(/https/)
    expect(() => loadEnv({ ...prod, APP_URL: 'http://api.getrelais.app' })).toThrow(/https/)
  })

  it('hors production, console et fs restent permis', () => {
    expect(loadEnv({ ...prod, NODE_ENV: 'development', HCV_ADDR: undefined, HCV_TOKEN: undefined, RELAIS_X25519_SK_DEV: 'ab'.repeat(32), EMAIL_TRANSPORT: 'console', STORAGE_BACKEND: 'fs', FRONTEND_URL: 'http://localhost:3000' }).EMAIL_TRANSPORT).toBe('console')
  })
})
