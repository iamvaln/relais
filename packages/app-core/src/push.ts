// Push OneSignal (docs/mobile.md §3) : l'utilisateur est connu du fournisseur
// par external_id = SHA256(user_id), jamais par son identifiant, son email ni
// son téléphone. Même calcul que côté API (services/push).

import { ready, sha256 } from '@relais/crypto-core'

export async function pushExternalId(userId: string): Promise<string> {
  await ready()
  return Buffer.from(sha256(new TextEncoder().encode(userId))).toString('hex')
}
