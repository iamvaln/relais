// Carnet de vie (DEC-31, Techniques §6) : contenu sous K2, signatures Ed25519
// exactement comme l'API les vérifie (content_enc, id UTF-8, stats_enc).

import { describe, expect, it } from 'vitest'
import { open } from '../src/aead.js'
import { deriveCategoryKeys, deriveSigningKeypair, verifyPayload } from '../src/keys.js'
import { mnemonicToSeed } from '../src/seed.js'
import { buildDeleteSignature, buildEntryPayload, buildWrappedPayload } from '../src/journal.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('journal', () => {
  it('entrée : content_enc sous K2 et signature sur SHA256(content_enc) ; suppression : signature sur l’id ; wrapped : stats_enc signées', async () => {
    const seed = mnemonicToSeed(VECTOR)
    const keys = await deriveCategoryKeys(seed)
    const signer = await deriveSigningKeypair(seed)
    const entry = await buildEntryPayload(keys.k2, { question_id: 'q', entry_month: '2026-09-01', mode: 'essential', texte: 'Ce mois-ci…' }, signer.privateKey, { word_count_approx: 3 })
    expect(entry).toMatchObject({ entry_month: '2026-09-01', mode: 'essential', question_id: 'q', word_count_approx: 3 })
    const enc = new Uint8Array(Buffer.from(entry.content_enc, 'base64'))
    expect(JSON.parse(Buffer.from(await open(keys.k2, enc)).toString('utf8')).texte).toBe('Ce mois-ci…')
    expect(await verifyPayload(enc, new Uint8Array(Buffer.from(entry.signature, 'base64')), signer.publicKey)).toBe(true)

    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
    const del = await buildDeleteSignature(id, signer.privateKey)
    expect(await verifyPayload(new TextEncoder().encode(id), new Uint8Array(Buffer.from(del.signature, 'base64')), signer.publicKey)).toBe(true)

    const wrapped = await buildWrappedPayload(keys.k2, { entries: 7, words: 1200 }, signer.privateKey)
    const stats = new Uint8Array(Buffer.from(wrapped.stats_enc, 'base64'))
    expect(JSON.parse(Buffer.from(await open(keys.k2, stats)).toString('utf8'))).toEqual({ entries: 7, words: 1200 })
    expect(await verifyPayload(stats, new Uint8Array(Buffer.from(wrapped.signature, 'base64')), signer.publicKey)).toBe(true)
  })
})
