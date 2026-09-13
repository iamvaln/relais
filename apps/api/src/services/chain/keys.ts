// Clé opérateur de la chaîne (docs/smart-contract-v2.md §3, §7) : secp256k1,
// scellée sous CHAIN_KEY_ENC_KEY (lib/enc.ts), déchiffrée au démarrage, hors
// HCV. Elle ne signe que des transactions ; l'owner, lui, signe en Ed25519.

import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { openSealed, seal } from '../../lib/enc.js'

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/

/** Pour `npm run chain:keygen` : une clé neuve, rendue scellée avec son adresse — le clair ne sort pas. */
export function generateOperatorKey(keyEncKey: string): { address: `0x${string}`; operatorKeyEnc: string } {
  const pk = generatePrivateKey()
  return { address: privateKeyToAccount(pk).address, operatorKeyEnc: seal(pk, keyEncKey) }
}

export function operatorAccount(operatorKeyEnc: string, keyEncKey: string): PrivateKeyAccount {
  const pk = openSealed(operatorKeyEnc, keyEncKey)
  if (!PRIVATE_KEY_RE.test(pk)) throw new Error('clé opérateur : 32 octets hex 0x attendus sous le scellé')
  return privateKeyToAccount(pk as `0x${string}`)
}
