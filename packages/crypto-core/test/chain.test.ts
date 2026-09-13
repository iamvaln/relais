// Contrat Arbitrum v2 (docs/smart-contract-v2.md D1) : l'identité on-chain est
// keccak256(ed25519_pk) ; chaque écriture qui engage l'owner porte sa signature
// Ed25519 sur SHA256 d'un message canonique — l'API vérifie exactement le même.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mnemonicToSeed } from '../src/seed.js'
import { deriveSigningKeypair } from '../src/keys.js'
import { chainMessage, chainSubject, signChainAction, verifyChainAction } from '../src/chain.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const DAY = 86_400

describe('chainSubject', () => {
  it('est keccak256 de la clé publique, en hex 0x sur 32 octets', () => {
    // Vecteur connu : keccak256(32 octets nuls)
    expect(chainSubject(new Uint8Array(32))).toBe('0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563')
    expect(chainSubject(new Uint8Array(32).fill(1))).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('refuse une clé qui ne fait pas 32 octets', () => {
    expect(() => chainSubject(new Uint8Array(31))).toThrow(/32/)
  })
})

describe('chainMessage', () => {
  it('est SHA256 du message canonique, champs absents à 0', () => {
    const subject = chainSubject(new Uint8Array(32))
    const expected = createHash('sha256').update(`relais:dms:v2|checkin|${subject}|${20_000 * DAY}|0|0|0|0|0`, 'utf8').digest()
    expect(Buffer.from(chainMessage('checkin', subject, { nextDue: 20_000 * DAY }))).toEqual(expected)
  })

  it("porte les paramètres d'enregistrement pour que l'opérateur ne puisse pas les substituer", () => {
    const subject = chainSubject(new Uint8Array(32))
    const a = chainMessage('register', subject, { nextDue: 20_000 * DAY, n: 2, m: 3, silenceSecs: 90 * DAY, checkinFreqSecs: 30 * DAY })
    const b = chainMessage('register', subject, { nextDue: 20_000 * DAY, n: 2, m: 4, silenceSecs: 90 * DAY, checkinFreqSecs: 30 * DAY })
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b))
    const expected = createHash('sha256')
      .update(`relais:dms:v2|register|${subject}|${20_000 * DAY}|0|2|3|${90 * DAY}|${30 * DAY}`, 'utf8')
      .digest()
    expect(Buffer.from(a)).toEqual(expected)
  })

  it('refuse une date qui n’est pas alignée au jour ou négative', () => {
    const subject = chainSubject(new Uint8Array(32))
    expect(() => chainMessage('checkin', subject, { nextDue: 20_000 * DAY + 1 })).toThrow(/jour/)
    expect(() => chainMessage('pause', subject, { pausedUntil: -DAY })).toThrow()
  })
})

describe('signChainAction / verifyChainAction', () => {
  it('signe le message avec la clé du seed et se vérifie avec la clé publique ; une autre action ne passe pas', async () => {
    const kp = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
    const subject = chainSubject(kp.publicKey)
    const sig = await signChainAction(kp.privateKey, 'checkin', subject, { nextDue: 20_000 * DAY })
    expect(sig).toHaveLength(64)
    expect(await verifyChainAction(kp.publicKey, sig, 'checkin', subject, { nextDue: 20_000 * DAY })).toBe(true)
    expect(await verifyChainAction(kp.publicKey, sig, 'cancelTrigger', subject, { nextDue: 20_000 * DAY })).toBe(false)
    expect(await verifyChainAction(kp.publicKey, sig, 'checkin', subject, { nextDue: 20_001 * DAY })).toBe(false)
  })
})
