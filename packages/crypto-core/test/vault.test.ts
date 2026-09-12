// Coffre (Techniques §5.2, DEC-07 tel que livré par l'API) :
//   P1 = seal(Ki, D)  → SQLite local
//   P2 = seal(Ki, P1) → Storj via POST /vault/sync { payload: P2, signature }
//   signature = Ed25519.sign(SHA256(P2))  — l'API vérifie sur le blob reçu.

import { describe, expect, it } from 'vitest'
import { deriveCategoryKeys, deriveSigningKeypair, verifyPayload } from '../src/keys.js'
import { mnemonicToSeed } from '../src/seed.js'
import { buildSyncPayload, encryptLocal, decryptLocal, openBackup, syncMessage } from '../src/vault.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('vault', () => {
  it('P1 se relit en local ; P2 et sa signature sont ce que POST /vault/sync attend ; P2 rouvre jusqu’à D', async () => {
    const seed = mnemonicToSeed(VECTOR)
    const keys = await deriveCategoryKeys(seed)
    const signer = await deriveSigningKeypair(seed)
    const rows = [{ service: 'Orange Money', login: '+237699000000', password: 'x' }]
    const D = new TextEncoder().encode(JSON.stringify(rows))

    const p1 = await encryptLocal(keys.k1, D)
    expect(Buffer.from(await decryptLocal(keys.k1, p1))).toEqual(Buffer.from(D))

    const sync = await buildSyncPayload('accounts', keys.k1, p1, signer.privateKey, 1_757_700_000_000)
    expect(sync.category).toBe('accounts')
    expect(sync.ts).toBe(1_757_700_000_000)
    expect(typeof sync.payload).toBe('string') // base64 de P2
    expect(typeof sync.signature).toBe('string')
    const p2 = Buffer.from(sync.payload, 'base64')
    // Audit MEDIUM-7 : la signature lie la catégorie et l'horodatage au blob
    expect(await verifyPayload(syncMessage('accounts', 1_757_700_000_000, new Uint8Array(p2)), Buffer.from(sync.signature, 'base64'), signer.publicKey)).toBe(true)
    expect(await verifyPayload(syncMessage('messages', 1_757_700_000_000, new Uint8Array(p2)), Buffer.from(sync.signature, 'base64'), signer.publicKey)).toBe(false)
    expect(await verifyPayload(p2, Buffer.from(sync.signature, 'base64'), signer.publicKey)).toBe(false)
    expect(Buffer.from(syncMessage('accounts', 5, new Uint8Array([9])))).toEqual(Buffer.concat([Buffer.from('relais:vault:v1|accounts|5|'), Buffer.from([9])]))

    // Restauration : P2 → P1 → D avec la clé de la catégorie
    const back = await openBackup(keys.k1, new Uint8Array(p2))
    expect(Buffer.from(back.p1)).toEqual(Buffer.from(p1))
    expect(Buffer.from(back.data)).toEqual(Buffer.from(D))
    await expect(openBackup(keys.k2, new Uint8Array(p2))).rejects.toThrow(/déchiffrement/)
  })
})
