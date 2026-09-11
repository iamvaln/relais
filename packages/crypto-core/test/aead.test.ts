// Enveloppe XChaCha20-Poly1305 (Techniques §2) : [version=1][nonce 24][ciphertext+tag].
// Toute donnée chiffrée du device (P1, P2, Si_enc, secret_enc, seed_enc_pin,
// verify_token, carnet) passe par ici.

import { describe, expect, it } from 'vitest'
import sodium from '../src/sodium.js'
import { ENVELOPE_VERSION, NONCE_BYTES, open, seal } from '../src/aead.js'

const key = () => sodium.crypto_secretbox_keygen()

describe('seal / open', () => {
  it('chiffre puis déchiffre, nonce aléatoire : deux enveloppes différentes pour le même clair', async () => {
    await sodium.ready
    const k = key()
    const plain = new TextEncoder().encode('{"service":"orange money"}')
    const a = await seal(k, plain)
    const b = await seal(k, plain)
    expect(a[0]).toBe(ENVELOPE_VERSION)
    expect(a).toHaveLength(1 + NONCE_BYTES + plain.length + 16)
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b))
    expect(Buffer.from(await open(k, a))).toEqual(Buffer.from(plain))
    expect(Buffer.from(await open(k, b))).toEqual(Buffer.from(plain))
  })

  it('refuse une mauvaise clé, un octet altéré, une version inconnue, une enveloppe trop courte', async () => {
    await sodium.ready
    const k = key()
    const env = await seal(k, new TextEncoder().encode('secret'))
    await expect(open(key(), env)).rejects.toThrow(/déchiffrement/)
    const tampered = Uint8Array.from(env)
    tampered[tampered.length - 1]! ^= 0x01
    await expect(open(k, tampered)).rejects.toThrow(/déchiffrement/)
    const badVersion = Uint8Array.from(env)
    badVersion[0] = 9
    await expect(open(k, badVersion)).rejects.toThrow(/version/)
    await expect(open(k, env.slice(0, 10))).rejects.toThrow(/enveloppe/)
  })

  it('données associées : liées à l’enveloppe, obligatoires pour ouvrir', async () => {
    await sodium.ready
    const k = key()
    const ad = new TextEncoder().encode('contact:42')
    const env = await seal(k, new TextEncoder().encode('x'), ad)
    expect(Buffer.from(await open(k, env, ad))).toEqual(Buffer.from([0x78]))
    await expect(open(k, env)).rejects.toThrow(/déchiffrement/)
  })
})
