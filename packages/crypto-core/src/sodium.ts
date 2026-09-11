// libsodium-wrappers-sumo : la build « sumo » expose crypto_pwhash (Argon2id),
// absent de la build standard qu'utilise l'API. Même quirk ESM que côté API
// (l'entrée .mjs importe un fichier qui n'existe que dans le package frère) :
// on charge la build CommonJS. Tout le cœur crypto passe par ce module — l'app
// mobile le remplace par react-native-libsodium, qui expose la même surface.

import { createRequire } from 'node:module'
import type sodiumType from 'libsodium-wrappers-sumo'

const require = createRequire(import.meta.url)
const sodium = require('libsodium-wrappers-sumo') as typeof sodiumType

export default sodium
