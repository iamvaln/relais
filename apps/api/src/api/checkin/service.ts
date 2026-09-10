// Check-in — preuve de vie mensuelle (Backend Specs §3.5, E4-US01 à E4-US05).

import { prisma } from '../../lib/prisma.js'

const DAY_MS = 24 * 3600 * 1000

// --- Vues ------------------------------------------------------------------------

export interface CheckinStatusView {
  transmission_status: string
  checkin_frequency_weeks: number
  next_checkin_due: string | null
  last_checkin_at: string | null
  overdue_days: number
  relance_count: number
  checked_in_this_month: boolean
}

export interface CheckinLogView {
  id: string
  month: string
  game_type: string
  attempts: number
  streak: number
  badge_earned: string | null
  journal_entry_id: string | null
  completed_at: string
}

/** Premier jour du mois courant (UTC) — la clé de checkin_log. */
export function monthOf(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

function toLogView(r: {
  id: string
  checkin_month: Date
  game_type: string
  attempts: number
  streak_at_checkin: number
  badge_earned: string | null
  journal_entry_id: string | null
  game_completed_at: Date
}): CheckinLogView {
  return {
    id: r.id,
    month: r.checkin_month.toISOString().slice(0, 10),
    game_type: r.game_type,
    attempts: r.attempts,
    streak: r.streak_at_checkin,
    badge_earned: r.badge_earned,
    journal_entry_id: r.journal_entry_id,
    completed_at: r.game_completed_at.toISOString(),
  }
}

// --- Statut ----------------------------------------------------------------------

export async function getStatus(userId: string, now = new Date()): Promise<CheckinStatusView> {
  const cfg = await prisma().transmission_configs.findUnique({ where: { user_id: userId } })
  const thisMonth = cfg
    ? await prisma().checkin_log.findUnique({ where: { user_id_checkin_month: { user_id: userId, checkin_month: monthOf(now) } }, select: { id: true } })
    : null
  const due = cfg?.next_checkin_due ?? null
  return {
    transmission_status: cfg?.status ?? 'inactive',
    checkin_frequency_weeks: cfg?.checkin_frequency_weeks ?? 4,
    next_checkin_due: due?.toISOString() ?? null,
    last_checkin_at: cfg?.last_checkin_at?.toISOString() ?? null,
    overdue_days: due && due < now ? Math.floor((now.getTime() - due.getTime()) / DAY_MS) : 0,
    relance_count: cfg?.relance_count ?? 0,
    checked_in_this_month: thisMonth !== null,
  }
}

export async function getHistory(userId: string, limit = 24): Promise<CheckinLogView[]> {
  const rows = await prisma().checkin_log.findMany({
    where: { user_id: userId },
    orderBy: { checkin_month: 'desc' },
    take: limit,
  })
  return rows.map(toLogView)
}

