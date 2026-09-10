// Relay — transmission côté contact (Backend Specs §3.7, Techniques §6.7–6.8, E5).
//
// Ouverture : quand le dead man's switch a déclenché (transmission_configs
// 'triggered'), une ligne `transmissions` fige le schéma N-of-M et l'escrow,
// chaque contact vivant reçoit un token de relay (HMAC en base, 72 h) par
// email — l'adresse sort de la sealed box le temps de l'envoi (DEC-28/30).

import { env } from '../../config/env.js'
import { configInt } from '../../lib/app-config.js'
import { hmacToken, randomToken } from '../../lib/crypto.js'
import { prisma } from '../../lib/prisma.js'
import { emailService } from '../../services/email/index.js'
import { openNotification } from '../transmission/service.js'

const HOUR_MS = 3600 * 1000
const DEFAULT_ESCROW_TTL_HOURS = 72

/** Crée la transmission d'une config déclenchée et prévient ses contacts. Retourne le nombre d'emails partis. */
export async function startTransmission(configId: string, now = new Date()): Promise<number> {
  const cfg = await prisma().transmission_configs.findUniqueOrThrow({
    where: { id: configId },
    include: {
      users: { select: { full_name: true, language: true } },
      trusted_contacts: { where: { contact_status: { not: 'removed' } }, orderBy: { contact_order: 'asc' } },
    },
  })
  const ttlHours = await configInt('dms.escrow_ttl_hours', DEFAULT_ESCROW_TTL_HOURS)
  const expiresAt = new Date(now.getTime() + ttlHours * HOUR_MS)

  const tokens: { contactId: string; token: string }[] = []
  await prisma().$transaction(async (tx) => {
    const tr = await tx.transmissions.create({
      data: {
        transmission_config_id: cfg.id,
        user_id: cfg.user_id,
        triggered_at: now,
        escrow_expires_at: expiresAt,
        schema_n_snapshot: cfg.schema_n,
        schema_m_snapshot: cfg.schema_m,
      },
      select: { id: true },
    })
    for (const c of cfg.trusted_contacts) {
      const token = randomToken(32)
      await tx.transmission_contacts.create({
        data: {
          transmission_id: tr.id,
          trusted_contact_id: c.id,
          relay_token_hash: hmacToken(token),
          relay_token_expires_at: expiresAt,
          notified_at: now,
        },
      })
      tokens.push({ contactId: c.id, token })
    }
  })

  // Emails hors transaction : un envoi qui échoue est tracé (email_log 'failed'), pas bloquant.
  let notified = 0
  const locale = cfg.users.language === 'en' ? 'en' : 'fr'
  for (const c of cfg.trusted_contacts) {
    const token = tokens.find((t) => t.contactId === c.id)!.token
    const { email } = await openNotification(c.notification_enc)
    const { sent } = await emailService().send({
      userId: cfg.user_id,
      to: email,
      type: 'transmission_contact',
      locale,
      params: { owner: cfg.users.full_name, link: `${env().FRONTEND_URL}/relay/${token}` },
    })
    if (sent) notified++
  }
  return notified
}
