// Purge horaire des tables transitoires (audit MEDIUM-9) : OTP, challenges de
// restauration et sessions expirés ne servent plus à rien et l'OTP porte
// l'adresse en clair. L'horloge est injectée ; BullMQ ne fait qu'appeler.

import { prisma } from '../lib/prisma.js'

export interface PurgeResult {
  otps: number
  challenges: number
  sessions: number
}

export async function purgeExpired(now = new Date()): Promise<PurgeResult> {
  const [otps, challenges, sessions] = await Promise.all([
    prisma().email_otp.deleteMany({ where: { expires_at: { lt: now } } }),
    prisma().restore_challenges.deleteMany({ where: { expires_at: { lt: now } } }),
    prisma().sessions.deleteMany({ where: { expires_at: { lt: now } } }),
  ])
  return { otps: otps.count, challenges: challenges.count, sessions: sessions.count }
}
