// Clés dérivées du seed (DEC-05, Techniques §5.1, Frontend §2.2-2.3) :
// K1/K2/K3 par Argon2id avec contexte distinct, paire Ed25519 depuis seed[0:32],
// signature de SHA256(payload) — la convention que l'API vérifie (DEC-07/29/31).

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import sodium from '../src/sodium.js'
import { mnemonicToSeed } from '../src/seed.js'
import { deriveCategoryKeys, deriveSigningKeypair, signPayload, signRaw, verifyPayload, verifyRaw, wipe } from '../src/keys.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

describe('deriveCategoryKeys', () => {
  it('trois clés de 32 octets, distinctes, déterministes, propres au seed', async () => {
    const seed = mnemonicToSeed(VECTOR)
    const a = await deriveCategoryKeys(seed)
    const b = await deriveCategoryKeys(mnemonicToSeed(VECTOR))
    const c = await deriveCategoryKeys(mnemonicToSeed(OTHER))
    for (const k of [a.k1, a.k2, a.k3]) expect(k).toHaveLength(32)
    expect(Buffer.from(a.k1)).toEqual(Buffer.from(b.k1))
    expect(Buffer.from(a.k2)).toEqual(Buffer.from(b.k2))
    expect(Buffer.from(a.k3)).toEqual(Buffer.from(b.k3))
    expect(Buffer.from(a.k1)).not.toEqual(Buffer.from(a.k2))
    expect(Buffer.from(a.k2)).not.toEqual(Buffer.from(a.k3))
    expect(Buffer.from(a.k1)).not.toEqual(Buffer.from(c.k1))
  })

  it('ne modifie pas le seed reçu', async () => {
    const seed = mnemonicToSeed(VECTOR)
    const copy = Buffer.from(seed)
    await deriveCategoryKeys(seed)
    expect(Buffer.from(seed)).toEqual(copy)
  })
})

describe('deriveSigningKeypair', () => {
  it('paire Ed25519 déterministe : même seed → même clé publique de 32 octets', async () => {
    const a = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
    const b = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
    const c = await deriveSigningKeypair(mnemonicToSeed(OTHER))
    expect(a.publicKey).toHaveLength(32)
    expect(a.privateKey).toHaveLength(64)
    expect(Buffer.from(a.publicKey)).toEqual(Buffer.from(b.publicKey))
    expect(Buffer.from(a.publicKey)).not.toEqual(Buffer.from(c.publicKey))
  })
})

describe('signatures', () => {
  it('signPayload signe SHA256(payload) : vérifiable par libsodium sur le hash, comme le fait le serveur', async () => {
    await sodium.ready
    const { publicKey, privateKey } = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
    const payload = new TextEncoder().encode('blob chiffré')
    const sig = await signPayload(payload, privateKey)
    expect(sig).toHaveLength(64)
    const hash = createHash('sha256').update(payload).digest()
    expect(sodium.crypto_sign_verify_detached(sig, hash, publicKey)).toBe(true)
    expect(await verifyPayload(payload, sig, publicKey)).toBe(true)
    expect(await verifyPayload(new TextEncoder().encode('autre'), sig, publicKey)).toBe(false)
  })

  it('signRaw signe le message tel quel (notification_sig, challenge de restauration)', async () => {
    await sodium.ready
    const { publicKey, privateKey } = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
    const msg = sodium.randombytes_buf(32)
    const sig = await signRaw(msg, privateKey)
    expect(sodium.crypto_sign_verify_detached(sig, msg, publicKey)).toBe(true)
    expect(await verifyRaw(msg, sig, publicKey)).toBe(true)
  })
})

describe('wipe', () => {
  it('met à zéro chaque tampon reçu', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([9])
    wipe(a, b)
    expect([...a]).toEqual([0, 0, 0])
    expect([...b]).toEqual([0])
  })
})
