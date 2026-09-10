// Nettoyage horaire des transmissions (Techniques §6.7, E5-US03, E5-US04).
//
// - Escrow expiré sans catégorie déverrouillée : la transmission passe
//   'expired', l'escrow est vidé (lignes + clé Redis), et le process repart
//   depuis le début — nouvelle transmission, nouveaux liens, nouveaux emails
//   (E5-US03 : « le process repart pour le contact qui n'a pas confirmé »).
// - Catégorie déverrouillée : l'accès dure 30 jours au-delà de l'escrow
//   (E5-US04), puis tout est purgé comme après un « J'ai terminé ».

import { accessExpiresAt, escrowKeyId, purgeTransmission, startTransmission } from '../api/relay/service.js'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

export interface CleanupResult {
  expired: number
  reopened: number
  purged: number
}

export async function cleanup(now = new Date()): Promise<CleanupResult> {
  const result: CleanupResult = { expired: 0, reopened: 0, purged: 0 }
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
    await startTransmission(tr.transmission_config_id, now)
    result.reopened++
  }
  return result
}
