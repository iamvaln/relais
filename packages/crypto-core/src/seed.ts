// Seed BIP39 (Techniques §2, §5.1 ; Frontend §3.1).
//
// 12 mots = 128 bits d'entropie, liste anglaise ou française officielle.
// seed = 64 octets BIP39 (PBKDF2-HMAC-SHA512, 2048 tours, passphrase vide) :
// c'est la seule matière première de toutes les clés du device (DEC-05).
// Les 12 mots ne sont JAMAIS stockés ; le seed ne vit qu'en mémoire.

import * as bip39 from '@scure/bip39'
import { wordlist as english } from '@scure/bip39/wordlists/english.js'
import { wordlist as french } from '@scure/bip39/wordlists/french.js'

export type MnemonicLanguage = 'en' | 'fr'

const WORDLISTS: Record<MnemonicLanguage, string[]> = { en: english, fr: french }
const STRENGTH_BITS = 128

/** Normalisation BIP39 : NFKD, minuscules, un seul espace entre les mots. */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.normalize('NFKD').toLowerCase().trim().split(/\s+/).join(' ')
}

export function generateMnemonic(language: MnemonicLanguage): string {
  return bip39.generateMnemonic(WORDLISTS[language], STRENGTH_BITS)
}

/** Langue de la phrase si elle est valide (12 mots, somme de contrôle), sinon null. */
export function validateMnemonic(mnemonic: string): MnemonicLanguage | null {
  const normalized = normalizeMnemonic(mnemonic)
  if (normalized.split(' ').length !== 12) return null
  for (const language of ['en', 'fr'] as const) {
    if (bip39.validateMnemonic(normalized, WORDLISTS[language])) return language
  }
  return null
}

/** 64 octets. Refuse une phrase invalide plutôt que de dériver des clés d'une faute de frappe. */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  const normalized = normalizeMnemonic(mnemonic)
  if (validateMnemonic(normalized) === null) throw new Error('Phrase de récupération invalide')
  return bip39.mnemonicToSeedSync(normalized)
}
