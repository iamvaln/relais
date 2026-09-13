// npm run chain:abi -w apps/api — régénère src/services/chain/abi.ts depuis
// l'artefact Foundry (contracts/out, `forge build`). L'ABI est commitée : l'API
// n'a pas besoin de Foundry pour tourner ; chain.test.ts vérifie qu'elle est à jour.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readArtifact, renderAbi } from '../services/chain/artifact.js'

const OUT = resolve(import.meta.dirname, '../services/chain/abi.ts')
writeFileSync(OUT, renderAbi(readArtifact().abi))
console.log(`ABI écrite dans ${OUT}`)
