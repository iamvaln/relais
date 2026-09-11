// Côté contact, post-mortem (Techniques §5.6, DEC-13, E5-US02) : tout en local.
//   réponses → K_i → verify_token s'ouvre ? → parts déchiffrées → POST /verify { shares }
//   GET /data { categories: { kj: { shares, p2 } } } → combine → Kj → P2 → P1 → D

import { describe, expect, it } from 'vitest'
import sodium from '../src/sodium.js'
import { deriveCategoryKeys, deriveSigningKeypair } from '../src/keys.js'
import { mnemonicToSeed } from '../src/seed.js'
import { buildSyncPayload, encryptLocal } from '../src/vault.js'
import { type QuestionIds } from '../src/contacts.js'
import { buildActivationBody, type ContactPlan } from '../src/activation.js'
import { answerRelay, openSecret, reconstruct } from '../src/relay.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const q = (n: number): QuestionIds => [`${n}1111111-1111-4111-8111-111111111111`, `${n}2222222-2222-4222-8222-222222222222`, `${n}3333333-3333-4333-8333-333333333333`]

describe('relay — parcours complet owner → contacts', () => {
  it('deux contacts K1 répondent, recombinent K1 et lisent les comptes ; une mauvaise réponse est détectée localement', async () => {
    await sodium.ready
    const seed = mnemonicToSeed(VECTOR)
    const keys = await deriveCategoryKeys(seed)
    const signer = await deriveSigningKeypair(seed)
    const relaisPk = Buffer.from(sodium.crypto_box_keypair().publicKey).toString('base64')
    const D = new TextEncoder().encode(JSON.stringify([{ service: 'MTN MoMo' }]))
    const sync = await buildSyncPayload('accounts', keys.k1, await encryptLocal(keys.k1, D), signer.privateKey)

    const contacts: ContactPlan[] = [1, 2].map((i) => ({
      id: `c${i}`,
      roles: { k1: true, k2: i === 1, k3: false },
      questionIds: q(i),
      answers: [`ville ${i}`, `chien ${i}`, `annee ${i}`],
      notification: { email: `c${i}@x.cm`, phone: null },
      secret: { nom: `Contact ${i}`, role: 'famille', message_personnel: `Pour toi, ${i}` },
    }))
    contacts[1]!.roles.k2 = true
    const body = await buildActivationBody({ keys, signer, relaisPk, contacts, schema: { n: 2, m: 2 }, silence_duration_months: 3, checkin_frequency_weeks: 4 })

    // Ce que GET /relay/:token rend à chaque contact
    const link = (i: number) => ({
      questions: q(i + 1).map((id) => ({ id })),
      roles: body.contacts[i]!.roles,
      verify_token: body.contacts[i]!.verify_token,
      shares_enc: { k1: body.contacts[i]!.shares.k1?.enc ?? null, k2: body.contacts[i]!.shares.k2?.enc ?? null, k3: body.contacts[i]!.shares.k3?.enc ?? null },
    })

    const wrong = await answerRelay(link(0), ['ville 1', 'chat', 'annee 1'])
    expect(wrong).toEqual({ ok: false })

    const a1 = await answerRelay(link(0), ['Ville 1', 'CHIEN 1 ', 'annee 1'])
    const a2 = await answerRelay(link(1), ['ville 2', 'chien 2', 'annee 2'])
    expect(a1.ok && a2.ok).toBe(true)
    if (!a1.ok || !a2.ok) throw new Error('unreachable')
    expect(Object.keys(a1.shares).sort()).toEqual(['k1', 'k2'])
    expect(Object.keys(a2.shares).sort()).toEqual(['k1', 'k2'])

    // Ce que GET /relay/:token/data rend une fois k1 et k2 déverrouillées
    const data = { secret_enc: body.contacts[0]!.secret_enc, categories: { k1: { category: 'accounts', shares: [a1.shares.k1!, a2.shares.k1!], p2: sync.payload }, k2: { category: 'messages', shares: [a1.shares.k2!, a2.shares.k2!], p2: null } } }
    const out = await reconstruct(data)
    expect(Buffer.from(out.categories.k1!.data!)).toEqual(Buffer.from(D))
    expect(out.categories.k2!.data).toBeNull()
    expect(Buffer.from(out.categories.k1!.key)).toEqual(Buffer.from(keys.k1))
    expect(await openSecret(out.categories.k2!.key, data.secret_enc)).toEqual({ nom: 'Contact 1', role: 'famille', message_personnel: 'Pour toi, 1' })
  })
})
