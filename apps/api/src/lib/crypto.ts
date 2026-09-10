// Primitives cryptographiques côté serveur.
//
// Ce que ce module NE fait PAS, par design (Specs Techniques, DEC-02, DEC-14) :
// il ne dérive aucune clé de chiffrement, ne déchiffre aucun blob, ne voit
// jamais le seed ni le PIN. Il hache des mots de passe pour l'auth serveur,
// hache des tokens avant stockage, et vérifie des signatures Ed25519.

import { createHash, createHmac, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify } from 'node:crypto'
import argon2 from 'argon2'
import { env } from '../config/env.js'

// --- Mots de passe (Argon2id — users.password_hash) -------------------------

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536, // 64 MiB
    timeCost: 3,
    parallelism: 1,
  })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

// --- Tokens opaques et leur empreinte --------------------------------------

/** Token aléatoire, encodé base64url. 32 bytes = 256 bits par défaut. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** OTP numérique à `digits` chiffres, tirage uniforme. */
export function randomOtp(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0')
}

/**
 * Empreinte d'un token avant stockage : HMAC-SHA256(token, TOKEN_HMAC_SECRET),
 * 64 hex — c'est ce qu'attendent sessions.refresh_token_hash et
 * transmission_contacts.relay_token_hash.
 *
 * Utilisée aussi pour email_otp.otp_hash : la spec y prévoit SHA256(otp) nu,
 * mais un OTP à 6 chiffres n'a qu'un million de valeurs — un SHA256 sans
 * secret se casse hors ligne en quelques millisecondes si la table fuit. Le
 * HMAC conserve le format (64 hex) et ferme cette porte.
 */
export function hmacToken(token: string): string {
  return createHmac('sha256', env().TOKEN_HMAC_SECRET).update(token).digest('hex')
}

/** SHA256 hex — pour recipient_hash (email) et l'anonymisation dans les logs. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Comparaison en temps constant de deux chaînes hex de même longueur. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

// --- Ed25519 (DEC-05, DEC-06, DEC-07) --------------------------------------

// Préfixe DER d'une clé publique Ed25519 en SubjectPublicKeyInfo (RFC 8410).
// Concaténé aux 32 bytes bruts, il donne une clé importable par Node.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export const ED25519_PK_BYTES = 32
export const ED25519_SIG_BYTES = 64

/** Vérifie `signature` sur `message` avec une clé publique Ed25519 brute (32 bytes). */
export function ed25519Verify(publicKeyRaw: Buffer, message: Buffer, signature: Buffer): boolean {
  if (publicKeyRaw.length !== ED25519_PK_BYTES || signature.length !== ED25519_SIG_BYTES) return false
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyRaw]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, message, key, signature)
  } catch {
    return false
  }
}

/** Décode un base64 (standard ou url) en Buffer, ou null si invalide. */
export function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null
  return Buffer.from(value, value.includes('-') || value.includes('_') ? 'base64url' : 'base64')
}
