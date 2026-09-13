// L'artefact Foundry du contrat (contracts/out/RelaisDms.sol/RelaisDms.json,
// produit par `forge build`) : lu par le script chain:abi et par les tests qui
// déploient sur Anvil. L'API en production n'en a pas besoin — l'ABI est commitée.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const ARTIFACT_PATH = resolve(import.meta.dirname, '../../../../../contracts/out/RelaisDms.sol/RelaisDms.json')

export function readArtifact(): { abi: unknown[]; bytecode: `0x${string}` } {
  const raw = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as { abi: unknown[]; bytecode: { object: `0x${string}` } }
  return { abi: raw.abi, bytecode: raw.bytecode.object }
}

export function renderAbi(abi: unknown[]): string {
  return [
    '// GÉNÉRÉ par `npm run chain:abi -w apps/api` depuis contracts/out — ne pas éditer.',
    '// ABI du contrat RelaisDms (contracts/src/RelaisDms.sol), figée dans le code',
    "// pour que l'API n'ait pas besoin de Foundry à l'exécution.",
    '',
    `export const relaisDmsAbi = ${JSON.stringify(abi, null, 2)} as const`,
    '',
  ].join('\n')
}
