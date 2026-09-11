// Nettoyage horaire des transmissions (Techniques §6.7, E5-US03, E5-US04).
//
// - Escrow expiré sans catégorie déverrouillée : la transmission passe
//   'expired', l'escrow est vidé (lignes + clé Redis), et le process repart
//   depuis le début — nouvelle transmission, nouveaux liens, nouveaux emails
//   (E5-US03 : « le process repart pour le contact qui n'a pas confirmé »).
//   Proposal-9 : au bout de dms.relay_max_restarts expirations (3), il ne
//   repart plus — la config reste 'triggered' sans transmission ouverte, et
//   le dashboard remonte une alerte transmission_stalled (BO-03).
// - Catégorie déverrouillée : l'accès dure 30 jours au-delà de l'escrow
//   (E5-US04), puis tout est purgé comme après un « J'ai terminé ».

import { accessExpiresAt, escrowKeyId, purgeTransmission, startTransmission } from '../api/relay/service.js'
import { configInt } from '../lib/app-config.js'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

export interface CleanupResult {
  expired: number
  reopened: number
  purged: number
  /** Expirées sans redémarrage : plafond atteint (Proposal-9). */
  stalled: number
}

export const DEFAULT_MAX_RESTARTS = 3

/** Nombre d'escrows expirés pour cette config ⇒ au-delà du plafond, plus de redémarrage automatique. */
export async function isStalled(configId: string, maxRestarts: number): Promise<boolean> {
  const expired = await prisma().transmissions.count({ where: { transmission_config_id: configId, status: 'expired' } })
  return expired >= maxRestarts
}

export async function cleanup(now = new Date()): Promise<CleanupResult> {
  const result: CleanupResult = { expired: 0, reopened: 0, purged: 0, stalled: 0 }
  const maxRestarts = await configInt('dms.relay_max_restarts', DEFAULT_MAX_RESTARTS)
  const due = await prisma().transmissions.findMany({
    where: { status: { in: ['triggered', 'in_progress'] }, escrow_expires_at: { lt: now } },
    select: {
      id: true,
      user_id: true,
      transmission_config_id: true,
      escrow_expires_at: true,
      k1_completed: true,
      k2_completed: true,
      k3_completed: true,
    },
  })

  for (const tr of due) {
    const unlocked = tr.k1_completed || tr.k2_completed || tr.k3_completed
    if (unlocked) {
      if (accessExpiresAt(tr.escrow_expires_at) < now) {
        await purgeTransmission(tr.id, tr.user_id, tr.transmission_config_id, now)
        result.purged++
      }
      continue
    }
    await redis().del(escrowKeyId(tr.id))
    await prisma().$transaction([
      prisma().escrow_shares.deleteMany({ where: { transmission_id: tr.id } }),
      prisma().transmissions.update({ where: { id: tr.id }, data: { status: 'expired' } }),
    ])
    result.expired++
    if (await isStalled(tr.transmission_config_id, maxRestarts)) {
      result.stalled++
      continue
    }
    await startTransmission(tr.transmission_config_id, now)
    result.reopened++
  }
  return result
}
