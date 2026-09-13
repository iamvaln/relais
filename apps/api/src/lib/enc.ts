// Scellé symétrique des secrets au repos (audit LOW-14b, lot 2a) :
// `enc1:` + base64(iv ‖ tag ‖ chiffré), AES-256-GCM, clé = SHA256(matière).
// Utilisé pour le secret TOTP (TOTP_ENC_KEY) et la clé opérateur de la chaîne
// (CHAIN_KEY_ENC_KEY). La matière est un secret d'environnement, jamais la
// clé AES elle-même.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const SEAL_PREFIX = 'enc1:'
const IV_BYTES = 12
const TAG_BYTES = 16

function aesKey(material: string): Buffer {
  return createHash('sha256').update(material, 'utf8').digest()
}

export function seal(plain: string, material: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', aesKey(material), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return SEAL_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function isSealed(value: string): boolean {
  return value.startsWith(SEAL_PREFIX)
}

/** Lance si le scellé est malformé, altéré, ou chiffré sous une autre matière. */
export function openSealed(sealed: string, material: string): string {
  if (!isSealed(sealed)) throw new Error(`scellé ${SEAL_PREFIX} attendu`)
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), 'base64')
  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ct = raw.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', aesKey(material), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
