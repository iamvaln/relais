// Secrets de Relais (DEC-15, DEC-18, DEC-30).
//
// Un seul secret cryptographique côté serveur : relais_x25519_sk, la clé
// X25519 qui ouvre les sealed boxes notification_enc des trusted contacts
// (DEC-28). HCV Secrets Engine la fournit en production (relais/x25519_sk) ;
// ici elle vient d'une variable d'environnement. Ce module est le SEUL
// endroit qui la lit — brancher HCV se fera ici, sans toucher aux appelants.

import sodium from '../../lib/sodium.js'
import { env } from '../../config/env.js'
import { sha256Hex } from '../../lib/crypto.js'

export interface RelaisKeypair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

let cached: RelaisKeypair | undefined

export async function relaisKeypair(): Promise<RelaisKeypair> {
  if (cached) return cached
  await sodium.ready
  const raw = env().RELAIS_X25519_SK
  const privateKey = new Uint8Array(Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64'))
  if (privateKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new Error(`RELAIS_X25519_SK : ${sodium.crypto_box_SECRETKEYBYTES} bytes attendus, ${privateKey.length} reçus`)
  }
  cached = { publicKey: sodium.crypto_scalarmult_base(privateKey), privateKey }
  return cached
}

/** Nom de la spec (Backend Specs §5, DEC-30). */
export async function getRelaisX25519Sk(): Promise<Uint8Array> {
  return (await relaisKeypair()).privateKey
}

export async function relaisPublicKeyBase64(): Promise<string> {
  return Buffer.from((await relaisKeypair()).publicKey).toString('base64')
}

/**
 * Identifiant de la clé publique en vigueur (DEC-28 « key_version ») : l'app le
 * stocke avec chaque notification_enc pour savoir, en cas de rotation, avec
 * quelle clé la boîte a été scellée.
 */
export async function relaisKeyVersion(): Promise<string> {
  return sha256Hex(Buffer.from((await relaisKeypair()).publicKey)).slice(0, 16)
}
