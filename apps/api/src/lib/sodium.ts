// libsodium-wrappers 0.7.x : son entrée ESM importe « ./libsodium.mjs » depuis
// son propre dossier, alors que ce fichier n'existe que dans le package
// frère `libsodium`. Node comme Vitest échouent à la résolution. La build
// CommonJS est saine — on la charge explicitement. Tout le code passe par ici.

import { createRequire } from 'node:module'
import type sodiumType from 'libsodium-wrappers'

const require = createRequire(import.meta.url)
const sodium = require('libsodium-wrappers') as typeof sodiumType

export default sodium
