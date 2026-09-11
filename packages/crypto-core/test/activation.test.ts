// Activation côté owner (Techniques §4, §5.3 ; API POST /transmission/activate) :
// pour chaque catégorie j, Kj est découpée N-of-|porteurs de kj| et la part i
// va au i-ème porteur, chiffrée avec sa clé de réponses et signée.

import { describe, expect, it } from 'vitest'
import sodium from '../src/sodium.js'
import { open } from '../src/aead.js'
import { deriveCategoryKeys, deriveSigningKeypair } from '../src/keys.js'
import { mnemonicToSeed } from '../src/seed.js'
import { combine } from '../src/shamir.js'
import { deriveContactKey, type QuestionIds } from '../src/contacts.js'
import { buildActivationBody, type ContactPlan } from '../src/activation.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const q = (n: number): QuestionIds => [`${n}1111111-1111-4111-8111-111111111111`, `${n}2222222-2222-4222-8222-222222222222`, `${n}3333333-3333-4333-8333-333333333333`]

describe('buildActivationBody', () => {
  it('2-of-3 avec rôles mixtes : parts aux bons porteurs, null sinon ; N parts recombinent chaque clé', async () => {
    await sodium.ready
    const seed = mnemonicToSeed(VECTOR)
    const keys = await deriveCategoryKeys(seed)
    const signer = await deriveSigningKeypair(seed)
    const relaisPk = Buffer.from(sodium.crypto_box_keypair().publicKey).toString('base64')
    const contacts: ContactPlan[] = [
      { id: 'c1', roles: { k1: true, k2: true, k3: false }, questionIds: q(1), answers: ['a', 'b', 'c'], notification: { email: 'c1@x.cm', phone: null }, secret: { nom: 'Un', role: 'frère', message_personnel: '' } },
      { id: 'c2', roles: { k1: true, k2: false, k3: true }, questionIds: q(2), answers: ['d', 'e', 'f'], notification: { email: 'c2@x.cm', phone: null }, secret: { nom: 'Deux', role: 'sœur', message_personnel: '' } },
      { id: 'c3', roles: { k1: true, k2: true, k3: true }, questionIds: q(3), answers: ['g', 'h', 'i'], notification: { email: 'c3@x.cm', phone: null }, secret: { nom: 'Trois', role: 'ami', message_personnel: '' } },
    ]
    const body = await buildActivationBody({ keys, signer, relaisPk, contacts, schema: { n: 2, m: 3 }, silence_duration_months: 3, checkin_frequency_weeks: 4 })
    expect(body.schema).toEqual({ n: 2, m: 3 })
    expect(body.contacts.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(body.contacts[0]!.shares.k3).toBeNull()
    expect(body.contacts[1]!.shares.k2).toBeNull()
    expect(body.contacts[2]!.shares.k1).not.toBeNull()
    expect(body.contacts[0]!.roles).toEqual({ k1: true, k2: true, k3: false })
    expect(body.contacts[0]!.question_ids).toEqual(q(1))
    expect(typeof body.contacts[0]!.verify_token).toBe('string')
    expect(typeof body.contacts[0]!.notification_enc).toBe('string')
    expect(typeof body.contacts[0]!.secret_enc).toBe('string')

    // Deux porteurs de k3 (c2, c3) : leurs parts recombinent K3 ; idem k1 avec c1+c2
    const kc2 = await deriveContactKey(['d', 'e', 'f'], q(2))
    const kc3 = await deriveContactKey(['g', 'h', 'i'], q(3))
    const s2 = await open(kc2, new Uint8Array(Buffer.from(body.contacts[1]!.shares.k3!.enc, 'base64')))
    const s3 = await open(kc3, new Uint8Array(Buffer.from(body.contacts[2]!.shares.k3!.enc, 'base64')))
    expect(Buffer.from(combine([s2, s3]))).toEqual(Buffer.from(keys.k3))
    const kc1 = await deriveContactKey(['a', 'b', 'c'], q(1))
    const s1 = await open(kc1, new Uint8Array(Buffer.from(body.contacts[0]!.shares.k1!.enc, 'base64')))
    const s1b = await open(kc2, new Uint8Array(Buffer.from(body.contacts[1]!.shares.k1!.enc, 'base64')))
    expect(Buffer.from(combine([s1, s1b]))).toEqual(Buffer.from(keys.k1))
  })

  it('refuse un rôle porté par moins de N contacts, ou M ≠ nombre de contacts', async () => {
    await sodium.ready
    const seed = mnemonicToSeed(VECTOR)
    const keys = await deriveCategoryKeys(seed)
    const signer = await deriveSigningKeypair(seed)
    const relaisPk = Buffer.from(sodium.crypto_box_keypair().publicKey).toString('base64')
    const base = { keys, signer, relaisPk, silence_duration_months: 3, checkin_frequency_weeks: 4 }
    const c = (id: string, roles: ContactPlan['roles']): ContactPlan => ({ id, roles, questionIds: q(1), answers: ['a', 'b', 'c'], notification: { email: `${id}@x.cm`, phone: null }, secret: { nom: id, role: 'x', message_personnel: '' } })
    await expect(buildActivationBody({ ...base, contacts: [c('c1', { k1: true, k2: true, k3: false }), c('c2', { k1: true, k2: false, k3: false })], schema: { n: 2, m: 2 } })).rejects.toThrow(/k2/)
    await expect(buildActivationBody({ ...base, contacts: [c('c1', { k1: true, k2: false, k3: false }), c('c2', { k1: true, k2: false, k3: false })], schema: { n: 2, m: 3 } })).rejects.toThrow(/M/)
  })
})
