// Check-in — preuve de vie mensuelle (Backend Specs §3.5, E4-US01 à E4-US05).

import { randomInt } from 'node:crypto'
import { randomToken } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { keys, redis } from '../../lib/redis.js'
import { GAMES, isCorrect, type Lang } from './games.js'

const DAY_MS = 24 * 3600 * 1000
const WEEK_MS = 7 * DAY_MS

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


// --- Mini-jeu (E4-US01) ----------------------------------------------------------

const GAME_TTL_S = 24 * 3600
const TOKEN_TTL_S = 15 * 60

export interface GameView {
  game_id: string
  game_type: string
  prompt: string
  choices: string[] | null
  attempts: number
}

interface PendingGame {
  id: string
  attempts: number
}

interface CheckinToken {
  userId: string
  game_type: string
  attempts: number
}

/** Le check-in n'a de sens que pour une transmission active (ou en pause). */
async function requireActiveTransmission(userId: string) {
  const cfg = await prisma().transmission_configs.findUnique({ where: { user_id: userId } })
  if (!cfg || (cfg.status !== 'active' && cfg.status !== 'paused')) {
    throw new AppError('TRANSMISSION_NOT_CONFIGURED', { message: 'Activez la transmission pour faire vos check-ins.' })
  }
  return cfg
}

async function pendingGame(userId: string): Promise<PendingGame | null> {
  const raw = await redis().get(keys.checkinGame(userId))
  return raw ? (JSON.parse(raw) as PendingGame) : null
}

export async function getGame(userId: string, lang: Lang): Promise<GameView> {
  await requireActiveTransmission(userId)
  let pending = await pendingGame(userId)
  if (!pending) {
    pending = { id: GAMES[randomInt(GAMES.length)]!.id, attempts: 0 }
    await redis().set(keys.checkinGame(userId), JSON.stringify(pending), 'EX', GAME_TTL_S)
  }
  const game = GAMES.find((g) => g.id === pending.id)!
  return {
    game_id: game.id,
    game_type: game.type,
    prompt: game.prompt[lang],
    choices: game.choices?.[lang] ?? null,
    attempts: pending.attempts,
  }
}

export interface AnswerResult {
  correct: boolean
  attempts: number
  checkin_token?: string
}

export async function answerGame(userId: string, lang: Lang, answer: string): Promise<AnswerResult> {
  await requireActiveTransmission(userId)
  const pending = await pendingGame(userId)
  if (!pending) throw new AppError('NOT_FOUND', { message: 'Aucun défi en cours — demandez-en un.' })
  const game = GAMES.find((g) => g.id === pending.id)!
  const attempts = pending.attempts + 1

  if (!isCorrect(game, lang, answer)) {
    await redis().set(keys.checkinGame(userId), JSON.stringify({ ...pending, attempts }), 'EX', GAME_TTL_S)
    return { correct: false, attempts }
  }

  const token = randomToken(32)
  const payload: CheckinToken = { userId, game_type: game.type, attempts }
  await redis().multi().del(keys.checkinGame(userId)).set(keys.checkinToken(token), JSON.stringify(payload), 'EX', TOKEN_TTL_S).exec()
  return { correct: true, attempts, checkin_token: token }
}

// --- Validation du check-in (E4-US01, E4-US05) ---------------------------------------

/** Badges : le tout premier check-in, puis les paliers de mois consécutifs. */
const STREAK_BADGES: Record<number, string> = { 3: 'streak_3', 6: 'streak_6', 12: 'streak_12' }

function previousMonth(month: Date): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1))
}

export interface CompleteResult {
  checked_in: true
  month: string
  streak: number
  badge_earned: string | null
  already_this_month: boolean
  next_checkin_due: string
}

async function consumeToken(userId: string, token: string): Promise<CheckinToken> {
  const [[, raw]] = (await redis().multi().get(keys.checkinToken(token)).del(keys.checkinToken(token)).exec()) as [[null, string | null], unknown]
  const payload = raw ? (JSON.parse(raw) as CheckinToken) : null
  if (!payload || payload.userId !== userId) {
    throw new AppError('AUTH_TOKEN_INVALID', { message: 'Jeton de check-in invalide ou expiré — rejouez.' })
  }
  return payload
}

export async function complete(userId: string, token: string, journalEntryId: string | undefined, now = new Date()): Promise<CompleteResult> {
  const cfg = await requireActiveTransmission(userId)
  const game = await consumeToken(userId, token)

  if (journalEntryId) {
    const entry = await prisma().journal_entries.findFirst({ where: { id: journalEntryId, user_id: userId }, select: { id: true } })
    if (!entry) throw new AppError('NOT_FOUND', { message: 'Entrée de carnet introuvable.' })
  }

  const month = monthOf(now)
  const existing = await prisma().checkin_log.findUnique({
    where: { user_id_checkin_month: { user_id: userId, checkin_month: month } },
    select: { streak_at_checkin: true },
  })

  let streak: number
  let badge: string | null = null
  if (existing) {
    streak = existing.streak_at_checkin
  } else {
    const [prev, before] = await Promise.all([
      prisma().checkin_log.findUnique({
        where: { user_id_checkin_month: { user_id: userId, checkin_month: previousMonth(month) } },
        select: { streak_at_checkin: true },
      }),
      prisma().checkin_log.count({ where: { user_id: userId } }),
    ])
    streak = prev ? prev.streak_at_checkin + 1 : 1
    badge = before === 0 ? 'first_checkin' : (STREAK_BADGES[streak] ?? null)
    await prisma().checkin_log.create({
      data: {
        user_id: userId,
        transmission_id: cfg.id,
        checkin_month: month,
        game_type: game.game_type,
        game_completed_at: now,
        attempts: game.attempts,
        streak_at_checkin: streak,
        badge_earned: badge,
        journal_entry_id: journalEntryId ?? null,
      },
    })
  }

  // Le check-in annule la procédure de relance en cours (§4.2) et repart pour un cycle.
  const nextDue = new Date(now.getTime() + cfg.checkin_frequency_weeks * WEEK_MS)
  await prisma().transmission_configs.update({
    where: { id: cfg.id },
    data: { last_checkin_at: now, next_checkin_due: nextDue, relance_count: 0, last_relance_at: null },
  })

  return {
    checked_in: true,
    month: month.toISOString().slice(0, 10),
    streak,
    badge_earned: badge,
    already_this_month: existing !== null,
    next_checkin_due: nextDue.toISOString(),
  }
}

// --- Streak et badges (E4-US05) --------------------------------------------------------

export interface StreakView {
  current: number
  longest: number
  badges: string[]
}

export async function getStreak(userId: string, now = new Date()): Promise<StreakView> {
  const rows = await prisma().checkin_log.findMany({
    where: { user_id: userId },
    orderBy: { checkin_month: 'asc' },
    select: { checkin_month: true, streak_at_checkin: true, badge_earned: true },
  })
  const latest = rows.at(-1)
  const month = monthOf(now).getTime()
  const alive = latest && (latest.checkin_month.getTime() === month || latest.checkin_month.getTime() === previousMonth(monthOf(now)).getTime())
  return {
    current: alive ? latest.streak_at_checkin : 0,
    longest: rows.reduce((m, r) => Math.max(m, r.streak_at_checkin), 0),
    badges: [...new Set(rows.map((r) => r.badge_earned).filter((b): b is string => b !== null))],
  }
}
