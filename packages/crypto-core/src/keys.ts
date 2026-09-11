// Clés dérivées du seed (DEC-05, Techniques §1, §5.1 ; Frontend §2.2-2.3).
//
//   K1 = Argon2id(seed, ctx 'relais_comptes_v1')    — comptes
//   K2 = Argon2id(seed, ctx 'relais_messages_v1')   — messages, secret_enc, carnet
//   K3 = Argon2id(seed, ctx 'relais_finances_v1')   — finances
//   { ed25519_sk, ed25519_pk } = crypto_sign_seed_keypair(seed[0:32])
//
// Le seed a 128 bits d'entropie : le coût d'Argon2id n'ajoute rien à sa
// sécurité, d'où les paramètres INTERACTIVE (64 Mo, ~0,1 s) — décision du
// 11 septembre 2026. Le sel est SHA256(ctx)[0:16] : public, fixe, propre à
// chaque catégorie. Signatures : Ed25519 sur SHA256(payload) (signPayload,
// convention DEC-07/29/31 vérifiée par l'API) ou sur le message brut
// (signRaw : notification_sig, challenge de restauration DEC-06).

import sodium from './sodium.js'

export const KEY_BYTES = 32
export const CONTEXTS = {
  k1: 'relais_comptes_v1',
  k2: 'relais_messages_v1',
  k3: 'relais_finances_v1',
} as const

export type KeySlot = keyof typeof CONTEXTS
export type CategoryKeys = Record<KeySlot, Uint8Array>

export interface SigningKeypair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export type KdfCost = 'interactive' | 'moderate'

/** Argon2id via libsodium. `moderate` (256 Mo) pour les secrets à faible entropie : PIN, réponses. */
export async function argon2id(password: Uint8Array | string, salt: Uint8Array, cost: KdfCost, length = KEY_BYTES): Promise<Uint8Array> {
  await sodium.ready
  if (salt.length !== sodium.crypto_pwhash_SALTBYTES) throw new Error(`sel : ${sodium.crypto_pwhash_SALTBYTES} octets attendus`)
  const ops = cost === 'moderate' ? sodium.crypto_pwhash_OPSLIMIT_MODERATE : sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE
  const mem = cost === 'moderate' ? sodium.crypto_pwhash_MEMLIMIT_MODERATE : sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE
  return sodium.crypto_pwhash(length, password, salt, ops, mem, sodium.crypto_pwhash_ALG_ARGON2ID13)
}

export function sha256(data: Uint8Array): Uint8Array {
  return sodium.crypto_hash_sha256(data)
}

/** Sel déterministe d'un contexte : SHA256(ctx)[0:16]. */
export function contextSalt(context: string): Uint8Array {
  return sha256(new TextEncoder().encode(context)).slice(0, sodium.crypto_pwhash_SALTBYTES)
}

export async function deriveCategoryKeys(seed: Uint8Array): Promise<CategoryKeys> {
  await sodium.ready
  const out = {} as CategoryKeys
  for (const slot of Object.keys(CONTEXTS) as KeySlot[]) {
    out[slot] = await argon2id(seed, contextSalt(CONTEXTS[slot]), 'interactive')
  }
  return out
}

export async function deriveSigningKeypair(seed: Uint8Array): Promise<SigningKeypair> {
  await sodium.ready
  const edSeed = seed.slice(0, sodium.crypto_sign_SEEDBYTES)
  try {
    const kp = sodium.crypto_sign_seed_keypair(edSeed)
    return { publicKey: kp.publicKey, privateKey: kp.privateKey }
  } finally {
    wipe(edSeed)
  }
}

export async function signPayload(payload: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready
  return sodium.crypto_sign_detached(sha256(payload), privateKey)
}

export async function verifyPayload(payload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  await sodium.ready
  return sodium.crypto_sign_verify_detached(signature, sha256(payload), publicKey)
}

export async function signRaw(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready
  return sodium.crypto_sign_detached(message, privateKey)
}

export async function verifyRaw(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  await sodium.ready
  return sodium.crypto_sign_verify_detached(signature, message, publicKey)
}

/** Efface des secrets en mémoire (seed, clés, D) — à appeler dès qu'ils ne servent plus. */
export function wipe(...buffers: Uint8Array[]): void {
  for (const b of buffers) b.fill(0)
}
