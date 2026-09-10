// Vault — backup et restauration du blob chiffré (Backend Specs §3.3 v1.1,
// DEC-07, DEC-16, DEC-21).
//
// Le serveur ne sait rien du contenu : ni combien de comptes, ni quelles
// catégories sont remplies, ni quand elles changent au-delà de la date du
// dernier upload. Aucune table vault en PostgreSQL (DEC-21) — l'état vit
// dans le stockage objet, et transmission_configs.storj_vault_path pointe
// vers le préfixe de l'utilisateur.

import { createHash } from 'node:crypto'
import { decodeBase64, ed25519Verify } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { objectStore } from '../../services/storage/index.js'
import { VAULT_CATEGORIES, type VaultCategory } from './schemas.js'

const DEFAULT_MAX_SIZE_MB = 50

/** Layout §5.2 : payloads/{user_id}/v1_{category}.enc */
export function vaultPrefix(userId: string): string {
  return `payloads/${userId}/`
}
export function vaultKey(userId: string, category: VaultCategory): string {
  return `${vaultPrefix(userId)}v1_${category}.enc`
}

async function maxSizeBytes(): Promise<number> {
  const row = await prisma().app_config.findUnique({ where: { key: 'vault.max_size_mb' }, select: { value: true } })
  const mb = row ? Number.parseInt(row.value, 10) : Number.NaN
  return (Number.isFinite(mb) ? mb : DEFAULT_MAX_SIZE_MB) * 1024 * 1024
}

/**
 * DEC-07 : seul le détenteur de ed25519_sk peut modifier le backup, même
 * avec un access token volé. La signature porte sur SHA256 du blob envoyé —
 * c'est la seule chose que le serveur puisse recalculer.
 */
export async function sync(
  userId: string,
  input: { category: VaultCategory; payload: string; signature: string },
): Promise<{ synced_at: string; storj_path: string; size: number }> {
  const user = await prisma().users.findUnique({ where: { id: userId }, select: { ed25519_pk: true } })
  if (!user) throw new AppError('AUTH_TOKEN_INVALID')
  if (!user.ed25519_pk) throw new AppError('AUTH_KEY_NOT_SET')

  const payload = decodeBase64(input.payload)
  const signature = decodeBase64(input.signature)
  if (!payload || payload.length === 0) throw new AppError('VALIDATION_ERROR', { details: { payload: 'base64 invalide ou vide' } })
  if (!signature) throw new AppError('VALIDATION_ERROR', { details: { signature: 'base64 invalide' } })

  const limit = await maxSizeBytes()
  if (payload.length > limit) {
    throw new AppError('PLAN_LIMIT_REACHED', {
      message: 'Le coffre dépasse la taille maximale autorisée.',
      details: { max_bytes: limit, size: payload.length },
    })
  }

  const hash = createHash('sha256').update(payload).digest()
  if (!ed25519Verify(Buffer.from(user.ed25519_pk), hash, signature)) {
    throw new AppError('AUTH_TOKEN_INVALID', { message: 'Signature du coffre invalide.' })
  }

  const key = vaultKey(userId, input.category)
  try {
    await objectStore().put(key, payload)
  } catch (err) {
    throw new AppError('VAULT_SYNC_FAILED', { cause: err })
  }

  // Premier sync : mémoriser le préfixe (§3.3 v1.1, étape 3). La ligne
  // transmission_configs est créée inactive si elle n'existe pas encore.
  const prefix = vaultPrefix(userId)
  await prisma().transmission_configs.upsert({
    where: { user_id: userId },
    create: { user_id: userId, storj_vault_path: prefix },
    update: { storj_vault_path: prefix },
  })

  return { synced_at: new Date().toISOString(), storj_path: key, size: payload.length }
}

export type SyncStatus = Record<VaultCategory, { synced_at: string; storj_path: string; size: number } | null>

export async function syncStatus(userId: string): Promise<SyncStatus> {
  const entries = await Promise.all(
    VAULT_CATEGORIES.map(async (category) => {
      const key = vaultKey(userId, category)
      const meta = await objectStore().head(key)
      return [category, meta ? { synced_at: meta.lastModified.toISOString(), storj_path: key, size: meta.size } : null] as const
    }),
  )
  return Object.fromEntries(entries) as SyncStatus
}

export async function restore(userId: string, category: VaultCategory): Promise<{ payload: string; size: number }> {
  let data: Uint8Array | null
  try {
    data = await objectStore().get(vaultKey(userId, category))
  } catch (err) {
    throw new AppError('VAULT_SYNC_FAILED', { message: 'Stockage indisponible.', cause: err })
  }
  if (!data) throw new AppError('NOT_FOUND', { message: 'Aucun backup pour cette catégorie.' })
  return { payload: Buffer.from(data).toString('base64'), size: data.length }
}

/** Purge complète — suppression RGPD et post-transmission (§5.2 deleteAll). */
export async function deleteAll(userId: string): Promise<number> {
  return objectStore().deletePrefix(vaultPrefix(userId))
}
