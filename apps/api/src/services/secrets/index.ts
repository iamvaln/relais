// Secrets de Relais (DEC-15, DEC-18).
//
// Un seul secret cryptographique côté serveur : relais_private_key, la clé
// X25519 qui ouvre les sealed boxes notification_enc des trusted contacts.
// La spec la place dans HCV Secrets Engine en production ; ici elle vient
// d'une variable d'environnement. Ce module est le SEUL endroit qui la lit —
// brancher HCV se fera ici, sans toucher aux appelants.

import sodium from '../../lib/sodium.js'
import { env } from '../../config/env.js'

export interface RelaisKeypair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

let cached: RelaisKeypair | undefined

export async function relaisKeypair(): Promise<RelaisKeypair> {
  if (cached) return cached
  await sodium.ready
  const privateKey = new Uint8Array(Buffer.from(env().RELAIS_PRIVATE_KEY, 'base64'))
  if (privateKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new Error(`RELAIS_PRIVATE_KEY : ${sodium.crypto_box_SECRETKEYBYTES} bytes attendus, ${privateKey.length} reçus`)
  }
  cached = { publicKey: sodium.crypto_scalarmult_base(privateKey), privateKey }
  return cached
}

export async function relaisPublicKeyBase64(): Promise<string> {
  return Buffer.from((await relaisKeypair()).publicKey).toString('base64')
}
