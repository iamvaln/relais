// BO-07 — Facturation. Encaissement manuel en V1 : le client paie par Mobile
// Money hors app, l'équipe enregistre le paiement ici. `subscriptions` est la
// source de vérité, `users.plan` en est le miroir (ce que lisent les tokens
// et les limites de plan).

import { configInt } from '../../lib/app-config.js'
import { audit } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import type { RequestContext } from './service.js'
import type { ExtendBody, PlanChangeBody, SubscriptionListQuery } from './schemas.js'
import type { Page } from './users.js'

const DAY_MS = 24 * 3600 * 1000
export const PREMIUM_MONTHS = 12
const DEFAULT_PRICE_FCFA = 10000

export interface SubscriptionView {
  id: string
  user_id: string
  plan: string
  status: string
  started_at: string
  expires_at: string | null
  grace_until: string | null
  cancelled_at: string | null
  price_fcfa: number | null
  currency: string
  auto_renew: boolean
  extended_count: number
  last_extended_by: string | null
  last_extended_at: string | null
  extension_reason: string | null
}

type Row = NonNullable<Awaited<ReturnType<typeof find>>>

async function find(id: string) {
  return prisma().subscriptions.findUnique({ where: { id } })
}

function toView(s: Row): SubscriptionView {
  return {
    id: s.id,
    user_id: s.user_id,
    plan: s.plan,
    status: s.status,
    started_at: s.started_at.toISOString(),
    expires_at: s.expires_at?.toISOString() ?? null,
    grace_until: s.grace_until?.toISOString() ?? null,
    cancelled_at: s.cancelled_at?.toISOString() ?? null,
    price_fcfa: s.price_fcfa,
    currency: s.currency,
    auto_renew: s.auto_renew,
    extended_count: s.extended_count,
    last_extended_by: s.last_extended_by,
    last_extended_at: s.last_extended_at?.toISOString() ?? null,
    extension_reason: s.extension_reason,
  }
}

async function rowOrThrow(id: string): Promise<Row> {
  const s = await find(id)
  if (!s) throw new AppError('NOT_FOUND', { message: 'Abonnement introuvable.' })
  return s
}

/** Douze mois à partir de l'échéance en cours si elle est encore devant nous, sinon d'aujourd'hui. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

function snapshot(s: Row): Record<string, unknown> {
  return { plan: s.plan, status: s.status, expires_at: s.expires_at?.toISOString() ?? null }
}

export async function listSubscriptions(q: SubscriptionListQuery): Promise<Page<SubscriptionView>> {
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10))
  const limit = Math.min(100, Math.max(1, Number.parseInt(q.limit ?? '20', 10)))
  const where = { ...(q.plan ? { plan: q.plan } : {}), ...(q.status ? { status: q.status } : {}) }
  const [total, rows] = await Promise.all([
    prisma().subscriptions.count({ where }),
    prisma().subscriptions.findMany({ where, orderBy: { updated_at: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ])
  return { items: rows.map(toView), total, page, limit }
}

/**
 * Passage ou renouvellement premium (paiement encaissé), ou rétrogradation
 * immédiate. Un renouvellement prolonge à partir de l'échéance en cours.
 */
export async function changePlan(adminId: string, id: string, body: PlanChangeBody, ctx: RequestContext, now = new Date()): Promise<SubscriptionView> {
  const s = await rowOrThrow(id)
  const before = snapshot(s)

  if (body.plan === 'free') {
    if (s.plan === 'free') throw new AppError('VALIDATION_ERROR', { message: 'Déjà en plan gratuit.', details: { plan: 'déjà gratuit' } })
    const [updated] = await prisma().$transaction([
      prisma().subscriptions.update({
        where: { id },
        data: { plan: 'free', status: 'active', expires_at: null, grace_until: null, price_fcfa: null, updated_at: now },
      }),
      prisma().users.update({ where: { id: s.user_id }, data: { plan: 'free' } }),
      prisma().payment_events.create({
        data: { user_id: s.user_id, subscription_id: id, event_type: 'admin_downgraded', notes: body.reason },
      }),
    ])
    await audit({ adminId, action: 'PLAN_CHANGE', targetType: 'subscription', targetId: id, userId: s.user_id, before, after: snapshot(updated), reason: body.reason, ip: ctx.ip })
    return toView(updated)
  }

  const renewing = s.plan === 'premium' && s.status !== 'expired'
  const base = renewing && s.expires_at && s.expires_at > now ? s.expires_at : now
  const price = body.amount_fcfa ?? (await configInt('billing.premium_price_fcfa', DEFAULT_PRICE_FCFA))
  const [updated] = await prisma().$transaction([
    prisma().subscriptions.update({
      where: { id },
      data: {
        plan: 'premium',
        status: 'active',
        ...(s.plan !== 'premium' ? { started_at: now } : {}),
        expires_at: addMonths(base, PREMIUM_MONTHS),
        grace_until: null,
        cancelled_at: null,
        price_fcfa: price,
        updated_at: now,
      },
    }),
    prisma().users.update({ where: { id: s.user_id }, data: { plan: 'premium' } }),
    prisma().payment_events.create({
      data: {
        user_id: s.user_id,
        subscription_id: id,
        event_type: renewing ? 'renewed' : 'created',
        amount_fcfa: price,
        provider_ref: body.provider_ref ?? null,
        notes: body.reason,
      },
    }),
  ])
  await audit({ adminId, action: 'PLAN_CHANGE', targetType: 'subscription', targetId: id, userId: s.user_id, before, after: snapshot(updated), reason: body.reason, ip: ctx.ip })
  return toView(updated)
}

/** Geste commercial : des jours en plus, sans paiement. Un compte en grâce ou expiré redevient premium actif. */
export async function extendSubscription(adminId: string, id: string, body: ExtendBody, ctx: RequestContext, now = new Date()): Promise<SubscriptionView> {
  const s = await rowOrThrow(id)
  const before = snapshot(s)
  const base = s.expires_at && s.expires_at > now ? s.expires_at : now
  const [updated] = await prisma().$transaction([
    prisma().subscriptions.update({
      where: { id },
      data: {
        plan: 'premium',
        status: 'active',
        expires_at: new Date(base.getTime() + body.days * DAY_MS),
        grace_until: null,
        extended_count: s.extended_count + 1,
        last_extended_by: adminId,
        last_extended_at: now,
        extension_reason: body.reason,
        updated_at: now,
      },
    }),
    prisma().users.update({ where: { id: s.user_id }, data: { plan: 'premium' } }),
    prisma().payment_events.create({ data: { user_id: s.user_id, subscription_id: id, event_type: 'admin_extended', notes: body.reason } }),
  ])
  await audit({ adminId, action: 'SUBSCRIPTION_EXTEND', targetType: 'subscription', targetId: id, userId: s.user_id, before, after: { ...snapshot(updated), days: body.days }, reason: body.reason, ip: ctx.ip })
  return toView(updated)
}
