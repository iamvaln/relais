// Enveloppe XChaCha20-Poly1305 (Techniques §2) — nonce 192 bits, tag 128 bits.
//
//   enveloppe = [version (1 octet)] [nonce (24)] [ciphertext + tag (n + 16)]
//
// La version en tête permet de changer d'algorithme ou de format plus tard
// sans ambiguïté sur les blobs déjà stockés (SQLite, Storj, PostgreSQL).
// Les erreurs ne distinguent pas mauvaise clé et altération : c'est le même
// message côté appelant, et c'est voulu.

import sodium from './sodium.js'

export const ENVELOPE_VERSION = 1
export const NONCE_BYTES = 24
const TAG_BYTES = 16

export async function seal(key: Uint8Array, plaintext: Uint8Array, associatedData: Uint8Array | null = null): Promise<Uint8Array> {
  await sodium.ready
  const nonce = sodium.randombytes_buf(NONCE_BYTES)
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, associatedData, null, nonce, key)
  const out = new Uint8Array(1 + NONCE_BYTES + ct.length)
  out[0] = ENVELOPE_VERSION
  out.set(nonce, 1)
  out.set(ct, 1 + NONCE_BYTES)
  return out
}

export async function open(key: Uint8Array, envelope: Uint8Array, associatedData: Uint8Array | null = null): Promise<Uint8Array> {
  await sodium.ready
  if (envelope.length < 1 + NONCE_BYTES + TAG_BYTES) throw new Error('enveloppe tronquée')
  if (envelope[0] !== ENVELOPE_VERSION) throw new Error(`version d'enveloppe inconnue : ${envelope[0]}`)
  const nonce = envelope.subarray(1, 1 + NONCE_BYTES)
  const ct = envelope.subarray(1 + NONCE_BYTES)
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, associatedData, nonce, key)
  } catch {
    throw new Error('déchiffrement impossible : clé incorrecte ou données altérées')
  }
}
