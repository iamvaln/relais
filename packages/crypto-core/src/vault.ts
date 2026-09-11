// Coffre (Techniques §1, §5.2 ; DEC-07/16/19 ; API POST /vault/sync).
//
//   D  : données en clair, mémoire vive uniquement
//   P1 = seal(Ki, D)   → SQLite local
//   P2 = seal(Ki, P1)  → Storj, via POST /vault/sync { category, payload: base64(P2), signature }
//   signature = Ed25519.sign(SHA256(P2))  — le blob envoyé, comme l'API le vérifie
//
// Une catégorie = une clé : accounts → K1, messages → K2, finances → K3.

import { open, seal } from './aead.js'
import { signPayload } from './keys.js'

export type VaultCategory = 'accounts' | 'messages' | 'finances'

export interface SyncPayload {
  category: VaultCategory
  payload: string
  signature: string
}

export function encryptLocal(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return seal(key, data)
}

export function decryptLocal(key: Uint8Array, p1: Uint8Array): Promise<Uint8Array> {
  return open(key, p1)
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** Corps de POST /vault/sync pour une catégorie : P2 = seal(Ki, P1), signé. */
export async function buildSyncPayload(category: VaultCategory, key: Uint8Array, p1: Uint8Array, signingKey: Uint8Array): Promise<SyncPayload> {
  const p2 = await seal(key, p1)
  const signature = await signPayload(p2, signingKey)
  return { category, payload: toBase64(p2), signature: toBase64(signature) }
}

/** Restauration (Techniques §5.5) : P2 → P1 (à ranger en SQLite) → D. */
export async function openBackup(key: Uint8Array, p2: Uint8Array): Promise<{ p1: Uint8Array; data: Uint8Array }> {
  const p1 = await open(key, p2)
  return { p1, data: await open(key, p1) }
}
