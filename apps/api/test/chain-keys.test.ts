// Clé opérateur (docs/smart-contract-v2.md §3) : secp256k1, jamais en clair
// dans l'environnement — chiffrée AES-256-GCM sous CHAIN_KEY_ENC_KEY, le même
// scellé que le secret TOTP (lib/enc.ts, audit LOW-14b), déchiffrée au démarrage.

import { describe, expect, it } from 'vitest'
import { openSealed, seal } from '../src/lib/enc.js'
import { decryptTotpSecret, encryptTotpSecret } from '../src/lib/totp.js'
import { generateOperatorKey, operatorAccount } from '../src/services/chain/keys.js'

const KEY = 'k'.repeat(40)

describe('lib/enc : scellé AES-256-GCM sous une clé dérivée', () => {
  it('seal → enc1:… et openSealed rend le clair ; deux scellés du même clair diffèrent (IV aléatoire)', () => {
    const a = seal('secret', KEY)
    const b = seal('secret', KEY)
    expect(a.startsWith('enc1:')).toBe(true)
    expect(a).not.toBe(b)
    expect(openSealed(a, KEY)).toBe('secret')
    expect(openSealed(b, KEY)).toBe('secret')
  })

  it('une autre clé ou un octet altéré ne s’ouvre pas', () => {
    const s = seal('secret', KEY)
    expect(() => openSealed(s, 'x'.repeat(40))).toThrow()
    const raw = Buffer.from(s.slice(5), 'base64')
    raw[raw.length - 1] ^= 1
    expect(() => openSealed('enc1:' + raw.toString('base64'), KEY)).toThrow()
    expect(() => openSealed('pas-un-scellé', KEY)).toThrow(/enc1/)
  })

  it('le secret TOTP reste chiffré par le même scellé, sous TOTP_ENC_KEY', () => {
    const stored = encryptTotpSecret('JBSWY3DPEHPK3PXP')
    expect(stored.startsWith('enc1:')).toBe(true)
    expect(decryptTotpSecret(stored)).toBe('JBSWY3DPEHPK3PXP')
    expect(openSealed(stored, process.env.TOTP_ENC_KEY!)).toBe('JBSWY3DPEHPK3PXP')
  })
})

describe('services/chain/keys : clé opérateur', () => {
  it('generateOperatorKey rend l’adresse et la clé scellée, jamais le clair ; operatorAccount la rouvre', () => {
    const { address, operatorKeyEnc } = generateOperatorKey(KEY)
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(operatorKeyEnc.startsWith('enc1:')).toBe(true)
    expect(JSON.stringify({ address, operatorKeyEnc })).not.toMatch(/[0-9a-f]{64}/)
    const account = operatorAccount(operatorKeyEnc, KEY)
    expect(account.address).toBe(address)
    expect(() => operatorAccount(operatorKeyEnc, 'z'.repeat(40))).toThrow()
  })

  it('une clé chiffrée qui ne contient pas 32 octets hex est refusée', () => {
    expect(() => operatorAccount(seal('pas une clé', KEY), KEY)).toThrow(/clé opérateur/)
  })
})
