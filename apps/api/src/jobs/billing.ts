// Cycle de vie des abonnements (BO-05 §5.5, BO-07) — quotidien.
//
// Échéance dépassée → 'grace' : le premium est conservé pendant
// billing.grace_period_days, l'utilisateur est prévenu de la date butoir.
// Grâce écoulée → 'expired' : plan gratuit des deux côtés (subscriptions et
// users.plan), email d'expiration. Chaque bascule laisse un payment_event.

import { configInt } from '../lib/app-config.js'
import { prisma } from '../lib/prisma.js'
import { emailService } from '../services/email/index.js'

const DAY_MS = 24 * 3600 * 1000
const DEFAULT_GRACE_DAYS = 7

export interface ExpireResult {
  graced: number
  expired: number
}

export async function expireSubscriptions(now = new Date()): Promise<ExpireResult> {
  const result: ExpireResult = { graced: 0, expired: 0 }
  const graceDays = await configInt('billing.grace_period_days', DEFAULT_GRACE_DAYS)

  const toGrace = await prisma().subscriptions.findMany({
    where: { plan: 'premium', status: 'active', expires_at: { lt: now } },
    include: { users: { select: { email: true, language: true } } },
  })
  for (const s of toGrace) {
    const graceUntil = new Date(s.expires_at!.getTime() + graceDays * DAY_MS)
    await prisma().$transaction([
      prisma().subscriptions.update({ where: { id: s.id }, data: { status: 'grace', grace_until: graceUntil, updated_at: now } }),
      prisma().payment_events.create({ data: { user_id: s.user_id, subscription_id: s.id, event_type: 'grace_started' } }),
    ])
    await emailService().send({
      userId: s.user_id,
      to: s.users.email,
      type: 'subscription_expiring',
      locale: s.users.language === 'en' ? 'en' : 'fr',
      params: { date: graceUntil.toISOString().slice(0, 10) },
    })
    result.graced++
  }

  const toExpire = await prisma().subscriptions.findMany({
    where: { status: 'grace', grace_until: { lt: now } },
    include: { users: { select: { email: true, language: true } } },
  })
  for (const s of toExpire) {
    await prisma().$transaction([
      prisma().subscriptions.update({ where: { id: s.id }, data: { plan: 'free', status: 'expired', updated_at: now } }),
      prisma().users.update({ where: { id: s.user_id }, data: { plan: 'free' } }),
      prisma().payment_events.create({ data: { user_id: s.user_id, subscription_id: s.id, event_type: 'expired' } }),
    ])
    await emailService().send({ userId: s.user_id, to: s.users.email, type: 'subscription_expired', locale: s.users.language === 'en' ? 'en' : 'fr' })
    result.expired++
  }
  return result
}
