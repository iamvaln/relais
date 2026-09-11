// Seed BIP39 (Techniques §2, §5.1 ; Frontend §3.1) : 12 mots, FR ou EN,
// jamais stockés. seed = 64 octets BIP39 (PBKDF2, passphrase vide).

import { describe, expect, it } from 'vitest'
import { wordlist as english } from '@scure/bip39/wordlists/english.js'
import { wordlist as french } from '@scure/bip39/wordlists/french.js'
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '../src/seed.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const VECTOR_SEED_HEX =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'

describe('generateMnemonic', () => {
  it('12 mots de la liste choisie, différents à chaque appel', () => {
    const en = generateMnemonic('en').split(' ')
    const fr = generateMnemonic('fr').split(' ')
    expect(en).toHaveLength(12)
    expect(fr).toHaveLength(12)
    expect(en.every((w) => english.includes(w))).toBe(true)
    expect(fr.every((w) => french.includes(w))).toBe(true)
    expect(generateMnemonic('en')).not.toBe(generateMnemonic('en'))
  })
})

describe('validateMnemonic', () => {
  it('reconnaît la langue, tolère casse et espaces, refuse une somme de contrôle fausse', () => {
    expect(validateMnemonic(VECTOR)).toBe('en')
    expect(validateMnemonic(generateMnemonic('fr'))).toBe('fr')
    expect(validateMnemonic(`  Abandon  ABANDON ${VECTOR.split(' ').slice(2).join('  ')} `)).toBe('en')
    expect(validateMnemonic(VECTOR.replace(/about$/, 'abandon'))).toBeNull()
    expect(validateMnemonic('pas une phrase')).toBeNull()
    expect(validateMnemonic(VECTOR.split(' ').slice(0, 11).join(' '))).toBeNull()
  })
})

describe('mnemonicToSeed', () => {
  it('64 octets, vecteur BIP39 connu (passphrase vide), déterministe et normalisé', () => {
    const seed = mnemonicToSeed(VECTOR)
    expect(seed).toHaveLength(64)
    expect(Buffer.from(seed).toString('hex')).toBe(VECTOR_SEED_HEX)
    expect(Buffer.from(mnemonicToSeed(`  ${VECTOR.toUpperCase()}  `))).toEqual(Buffer.from(seed))
  })

  it('refuse une phrase invalide', () => {
    expect(() => mnemonicToSeed(VECTOR.replace(/about$/, 'abandon'))).toThrow(/invalide/)
  })
})
