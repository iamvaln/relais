// Contacts de confiance, côté owner (Techniques §5.3, DEC-12/20/28/29, Proposal-8).
//   K_i          = Argon2id(réponses normalisées, sel = SHA256('relais_contact_v1|q1|q2|q3')[0:16], MODERATE)
//   verify_token = seal(K_i, 'RELAIS_VERIFY_OK_V1')
//   notification_enc = crypto_box_seal({ email, phone, owner_display_name? }, relais_x25519_pk), signé brut
//   secret_enc   = seal(K2, { nom, role, message_personnel })
//   part         : enc = seal(K_i, Si), sig = sign(SHA256(enc)), plain_hash = SHA256(Si), plain_sig = sign(plain_hash)

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import sodium from '../src/sodium.js'
import { open } from '../src/aead.js'
import { deriveCategoryKeys, deriveSigningKeypair, verifyPayload, verifyRaw } from '../src/keys.js'
import { mnemonicToSeed } from '../src/seed.js'
import { split } from '../src/shamir.js'
import {
  buildVerifyToken,
  checkVerifyToken,
  contactSalt,
  deriveContactKey,
  encryptSecret,
  normalizeAnswer,
  prepareShare,
  sealNotification,
} from '../src/contacts.js'
import { openSecret } from '../src/relay.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const Q: [string, string, string] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']

describe('normalizeAnswer', () => {
  it('même règle que le check-in : NFD sans accents, minuscules, ponctuation → espace, espaces réduits', () => {
    expect(normalizeAnswer('  Yaoundé ')).toBe('yaounde')
    expect(normalizeAnswer('DOUALA')).toBe('douala')
    expect(normalizeAnswer("L'école, à Bafia !")).toBe('l ecole a bafia')
    expect(normalizeAnswer('Cœur  de   lion')).toBe('coeur de lion')
    expect(normalizeAnswer('1990')).toBe('1990')
  })
})

describe('deriveContactKey', () => {
  it('32 octets, insensible à la casse et aux accents, propre aux questions', async () => {
    const a = await deriveContactKey(['Yaoundé', 'Rex', '1990'], Q)
    const b = await deriveContactKey(['  yaounde', 'REX ', '1990'], Q)
    const c = await deriveContactKey(['Douala', 'Rex', '1990'], Q)
    const d = await deriveContactKey(['Yaoundé', 'Rex', '1990'], [Q[0], Q[1], '44444444-4444-4444-8444-444444444444'])
    expect(a).toHaveLength(32)
    expect(Buffer.from(a)).toEqual(Buffer.from(b))
    expect(Buffer.from(a)).not.toEqual(Buffer.from(c))
    expect(Buffer.from(a)).not.toEqual(Buffer.from(d))
    expect(contactSalt(Q)).toHaveLength(16)
    expect(Buffer.from(contactSalt(Q))).toEqual(createHash('sha256').update(`relais_contact_v1|${Q.join('|')}`).digest().subarray(0, 16))
  })
})

describe('verify_token', () => {
  it('s’ouvre avec la bonne clé de contact, pas avec une autre', async () => {
    const k = await deriveContactKey(['a', 'b', 'c'], Q)
    const other = await deriveContactKey(['a', 'b', 'd'], Q)
    const token = await buildVerifyToken(k)
    expect(typeof token).toBe('string')
    expect(await checkVerifyToken(k, token)).toBe(true)
    expect(await checkVerifyToken(other, token)).toBe(false)
  })
})

describe('notification_enc / notification_sig', () => {
  it('sealed box vers la clé de Relais, JSON { email, phone, owner_display_name }, signature brute vérifiable', async () => {
    await sodium.ready
    const relais = sodium.crypto_box_keypair()
    const signer = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
    const n = await sealNotification(Buffer.from(relais.publicKey).toString('base64'), { email: 'c@example.cm', phone: '+237699000000', owner_display_name: 'Adjoua' }, signer.privateKey)
    const enc = Buffer.from(n.notification_enc, 'base64')
    const opened = sodium.crypto_box_seal_open(new Uint8Array(enc), relais.publicKey, relais.privateKey)
    expect(JSON.parse(Buffer.from(opened).toString('utf8'))).toEqual({ email: 'c@example.cm', phone: '+237699000000', owner_display_name: 'Adjoua' })
    expect(await verifyRaw(new Uint8Array(enc), new Uint8Array(Buffer.from(n.notification_sig, 'base64')), signer.publicKey)).toBe(true)
  })
})

describe('secret_enc', () => {
  it('chiffré sous K2, relu par l’owner seulement', async () => {
    const keys = await deriveCategoryKeys(mnemonicToSeed(VECTOR))
    const b64 = await encryptSecret(keys.k2, { nom: 'Ngo Adjoua', role: 'sœur', message_personnel: 'Merci' })
    const clear = JSON.parse(Buffer.from(await open(keys.k2, new Uint8Array(Buffer.from(b64, 'base64')))).toString('utf8'))
    expect(clear).toEqual({ nom: 'Ngo Adjoua', role: 'sœur', message_personnel: 'Merci' })
    await expect(open(keys.k1, new Uint8Array(Buffer.from(b64, 'base64')))).rejects.toThrow()
  })

  it('porte aussi email et téléphone du contact, pour que l’owner les retrouve sur un nouveau device (lot 4 mobile)', async () => {
    const keys = await deriveCategoryKeys(mnemonicToSeed(VECTOR))
    const clear = { nom: 'Ngo Adjoua', role: 'sœur', message_personnel: 'Merci', email: 'adjoua@example.cm', phone: '+237699000000' }
    const b64 = await encryptSecret(keys.k2, clear)
    expect(await openSecret(keys.k2, b64)).toEqual(clear)
    const phoneless = { ...clear, phone: null }
    expect(await openSecret(keys.k2, await encryptSecret(keys.k2, phoneless))).toEqual(phoneless)
  })
})

describe('prepareShare', () => {
  it('enc s’ouvre avec K_i sur la part, sig sur SHA256(enc), plain_hash = SHA256(part) hex, plain_sig sur ce hash', async () => {
    await sodium.ready
    const signer = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
    const k = await deriveContactKey(['a', 'b', 'c'], Q)
    const [share] = split(sodium.randombytes_buf(32), 2, 2)
    const p = await prepareShare(share!, k, signer.privateKey)
    const enc = new Uint8Array(Buffer.from(p.enc, 'base64'))
    expect(Buffer.from(await open(k, enc))).toEqual(Buffer.from(share!))
    expect(await verifyPayload(enc, new Uint8Array(Buffer.from(p.sig, 'base64')), signer.publicKey)).toBe(true)
    expect(p.plain_hash).toBe(createHash('sha256').update(share!).digest('hex'))
    expect(await verifyPayload(share!, new Uint8Array(Buffer.from(p.plain_sig, 'base64')), signer.publicKey)).toBe(true)
  })
})
