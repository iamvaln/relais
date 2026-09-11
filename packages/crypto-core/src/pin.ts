// seed_enc_pin (DEC-01 à DEC-04, Frontend §2.2, Techniques §5.1/§5.4).
//
//   pin_key      = Argon2id(PIN, sel aléatoire, MODERATE)   — 6 chiffres : le coût du KDF est la seule défense
//   seed_enc_pin = seal(pin_key, seed)
//
// Le blob et son sel vont dans expo-secure-store, PERMANENT (DEC-01). Le
// backoff des tentatives est côté app (DEC-26) ; ici on ne fait qu'ouvrir.

import { argon2id, wipe } from './keys.js'
import { open, seal } from './aead.js'
import sodium from './sodium.js'

export interface LockedSeed {
  seed_enc_pin: Uint8Array
  salt: Uint8Array
}

const PIN_CONTEXT = new TextEncoder().encode('relais_pin_enc_v1')

/** Chiffre le seed avec le PIN, puis efface le seed reçu. */
export async function lockSeedWithPin(seed: Uint8Array, pin: string): Promise<LockedSeed> {
  await sodium.ready
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
  const pinKey = await argon2id(pin, salt, 'moderate')
  try {
    return { seed_enc_pin: await seal(pinKey, seed, PIN_CONTEXT), salt }
  } finally {
    wipe(pinKey, seed)
  }
}

/** Rend le seed (64 octets) ; PIN faux → erreur, sans dire pourquoi. */
export async function unlockSeedWithPin(locked: LockedSeed, pin: string): Promise<Uint8Array> {
  const pinKey = await argon2id(pin, locked.salt, 'moderate')
  try {
    return await open(pinKey, locked.seed_enc_pin, PIN_CONTEXT)
  } catch {
    throw new Error('PIN incorrect')
  } finally {
    wipe(pinKey)
  }
}
