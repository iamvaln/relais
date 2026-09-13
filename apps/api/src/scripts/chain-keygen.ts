// npm run chain:keygen -w apps/api -- --key-enc-key <CHAIN_KEY_ENC_KEY>
// Génère la clé opérateur de la chaîne et n'imprime que son adresse (à
// approvisionner en ETH et à passer au constructeur du contrat) et sa forme
// scellée (CHAIN_OPERATOR_KEY_ENC). Le clair n'est jamais affiché ni écrit.

import { generateOperatorKey } from '../services/chain/keys.js'

const args = process.argv.slice(2)
const i = args.indexOf('--key-enc-key')
const keyEncKey = i >= 0 ? args[i + 1] : process.env.CHAIN_KEY_ENC_KEY
if (!keyEncKey || keyEncKey.length < 32) {
  console.error('usage : chain-keygen --key-enc-key <32 caractères minimum>  (ou CHAIN_KEY_ENC_KEY dans l’env)')
  process.exit(2)
}
const { address, operatorKeyEnc } = generateOperatorKey(keyEncKey)
console.log(`Adresse opérateur      : ${address}`)
console.log(`CHAIN_OPERATOR_KEY_ENC=${operatorKeyEnc}`)
