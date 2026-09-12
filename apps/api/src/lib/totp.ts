// TOTP : secret chiffré en base et anti-rejeu du pas (audit LOW-14).
//
// - Le secret base32 est stocké sous `enc1:` + base64(iv ‖ tag ‖ chiffré),
//   AES-256-GCM, clé = SHA256(TOTP_ENC_KEY). Une valeur legacy sans préfixe
//   est lue telle quelle (bases de dev antérieures) et réécrite chiffrée à la
//   prochaine écriture.
// - Un code accepté « brûle » son pas (30 s) pour ce compte : le dernier pas
//   consommé est mémorisé dans Redis et un pas ≤ à celui-là est refusé, en une
//   opération atomique — deux validations parallèles du même code n'en
//   laissent passer qu'une.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import { env } from '../config/env.js'
import { keys, redis } from './redis.js'

const PREFIX = 'enc1:'
const IV_BYTES = 12
const TAG_BYTES = 16
const PERIOD_S = 30
/** Fenêtre de validation ± 1 pas : un pas brûlé n'a plus d'intérêt après 2 minutes. */
const STEP_TTL_S = 120

function key(): Buffer {
  return createHash('sha256').update(env().TOTP_ENC_KEY, 'utf8').digest()
}

export function encryptTotpSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decryptTotpSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored // legacy en clair
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ct = raw.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

export function totpFor(secret: string, label: string, issuer = 'Relais'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({ issuer, label, algorithm: 'SHA1', digits: 6, period: PERIOD_S, secret })
}

// Refuse si un pas ≥ au pas proposé a déjà été consommé pour ce compte.
const CONSUME_STEP = `
local last = redis.call('GET', KEYS[1])
if last and tonumber(last) >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
`

/**
 * Vérifie le code (± 1 pas) puis consomme son pas pour `scope` (`u:{userId}`
 * ou `a:{adminId}`). Vrai une seule fois par code et par compte.
 */
export async function verifyTotpOnce(scope: string, secret: string, code: string, now = Date.now()): Promise<boolean> {
  const delta = totpFor(secret, scope).validate({ token: code, window: 1, timestamp: now })
  if (delta === null) return false
  const step = Math.floor(now / (PERIOD_S * 1000)) + delta
  const ok = await redis().eval(CONSUME_STEP, 1, keys.twoFactorStep(scope), String(step), String(STEP_TTL_S))
  return ok === 1
}
