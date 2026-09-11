// BO-01 — Dashboard : KPIs et alertes calculables sur la base. Les alertes
// qui supposent des métriques d'infrastructure (HCV, taux d'erreur, espace
// Storj) attendent une collecte qui n'existe pas encore (open-questions).

import { configInt } from '../../lib/app-config.js'
import { prisma } from '../../lib/prisma.js'
import { healthReport } from '../health/routes.js'

const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS
const ACTIVE_WINDOW_DAYS = 30
const ESCROW_ALERT_HOURS = 12
const BLOCKED_SPIKE_THRESHOLD = 3
const SUSPENDED_STALE_HOURS = 24

export interface DashboardKpis {
  users_total: number
  users_active_30d: number
  premium_active: number
  transmissions_triggered_this_month: number
  transmissions_completed_this_month: number
  transmissions_completed_total: number
  /** % des transmissions actives dont le check-in est à jour ; null sans transmission active. */
  checkin_rate: number | null
  revenue_this_month_fcfa: number
  tickets_open: number
}

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface DashboardAlert {
  type: string
  severity: AlertSeverity
  count: number
  [k: string]: unknown
}

export interface DashboardView {
  generated_at: string
  kpis: DashboardKpis
  alerts: DashboardAlert[]
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

async function kpis(now: Date): Promise<DashboardKpis> {
  const since = monthStart(now)
  const activeSince = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS)
  const [usersTotal, activeUsers, premium, triggered, completedMonth, completedTotal, activeTransmissions, onTime, revenue, tickets] = await Promise.all([
    prisma().users.count({ where: { account_status: { not: 'deleted' } } }),
    prisma().sessions.findMany({ where: { last_used_at: { gte: activeSince }, users: { account_status: { not: 'deleted' } } }, distinct: ['user_id'], select: { user_id: true } }),
    prisma().subscriptions.count({ where: { plan: 'premium', status: { in: ['active', 'grace'] } } }),
    prisma().transmissions.count({ where: { triggered_at: { gte: since } } }),
    prisma().transmissions.count({ where: { status: 'completed', completed_at: { gte: since } } }),
    prisma().transmissions.count({ where: { status: 'completed' } }),
    prisma().transmission_configs.count({ where: { status: 'active' } }),
    prisma().transmission_configs.count({ where: { status: 'active', next_checkin_due: { gte: now } } }),
    prisma().payment_events.aggregate({ where: { event_type: { in: ['created', 'renewed'] }, created_at: { gte: since } }, _sum: { amount_fcfa: true } }),
    prisma().support_tickets.count({ where: { status: { in: ['open', 'in_progress'] } } }),
  ])
  return {
    users_total: usersTotal,
    users_active_30d: activeUsers.length,
    premium_active: premium,
    transmissions_triggered_this_month: triggered,
    transmissions_completed_this_month: completedMonth,
    transmissions_completed_total: completedTotal,
    checkin_rate: activeTransmissions === 0 ? null : Math.round((onTime / activeTransmissions) * 1000) / 10,
    revenue_this_month_fcfa: revenue._sum.amount_fcfa ?? 0,
    tickets_open: tickets,
  }
}

async function alerts(now: Date): Promise<DashboardAlert[]> {
  const out: DashboardAlert[] = []
  const lockHours = await configInt('security.contact_lock_hrs', 24)

  const [health, expiring, blockedRecently, suspendedStale] = await Promise.all([
    healthReport(),
    prisma().transmissions.findMany({
      where: { status: { in: ['triggered', 'in_progress'] }, escrow_expires_at: { gt: now, lt: new Date(now.getTime() + ESCROW_ALERT_HOURS * HOUR_MS) } },
      select: { id: true },
      orderBy: { escrow_expires_at: 'asc' },
    }),
    // Un blocage dure lockHours : bloqué depuis moins d'une heure ⇔ blocked_until > now + (lockHours − 1) h.
    prisma().trusted_contacts.count({ where: { blocked_until: { gt: new Date(now.getTime() + (lockHours - 1) * HOUR_MS) } } }),
    prisma().users.count({ where: { account_status: 'suspended', updated_at: { lt: new Date(now.getTime() - SUSPENDED_STALE_HOURS * HOUR_MS) } } }),
  ])

  for (const [service, status] of Object.entries(health.services)) {
    if (status === 'down') out.push({ type: 'service_down', severity: service === 'storj' ? 'high' : 'critical', count: 1, service })
  }
  if (expiring.length > 0) out.push({ type: 'escrow_expiring', severity: 'high', count: expiring.length, transmission_ids: expiring.map((t) => t.id) })
  if (blockedRecently > BLOCKED_SPIKE_THRESHOLD) out.push({ type: 'contact_failures_spike', severity: 'high', count: blockedRecently })
  if (suspendedStale > 0) out.push({ type: 'accounts_suspended_stale', severity: 'medium', count: suspendedStale })

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

export async function dashboard(now = new Date()): Promise<DashboardView> {
  const [k, a] = await Promise.all([kpis(now), alerts(now)])
  return { generated_at: now.toISOString(), kpis: k, alerts: a }
}
