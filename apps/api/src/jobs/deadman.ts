// Dead man's switch — balayage quotidien (Backend Specs §4.2, E4-US02).
//
// Une transmission active dont l'échéance de check-in est dépassée reçoit
// trois relances (J+7, J+14, J+21 après l'échéance — dms.relance_intervals_days),
// chacune tracée dans checkin_relances et email_log. Le déclenchement
// n'intervient qu'une fois les trois relances envoyées ET le silence
// configuré écoulé (silence_duration_months) : c'est ce paramètre, choisi
// par l'utilisateur, qui décide du moment. La suite (tokens des contacts,
// emails /relay) appartient au module relay.
//
// Lot 5 mobile (décision du 12/09/2026) : le même balayage pousse une
// notification le jour de l'échéance, avec la relance 1, et trois jours
// avant la fin d'une pause (email pause_ending aussi) ; une pause arrivée à
// son terme reprend seule. Les envois sont déterminés par la fenêtre du jour
// — le job tourne une fois par jour — et ne laissent aucune trace en base.
//
// Pure au sens utile : l'horloge est injectée, aucune file d'attente ici.

import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { emailService, type EmailType, type Locale } from '../services/email/index.js'
import { pushService, type PushType } from '../services/push/index.js'
import { startTransmission } from '../api/relay/service.js'

const DAY_MS = 24 * 3600 * 1000
const WEEK_MS = 7 * DAY_MS
const MONTH_DAYS = 30
const PAUSE_REMINDER_DAYS = 3
const MAX_RELANCES = 3 // chk relance_count BETWEEN 0 AND 3
const DEFAULT_INTERVALS = [7, 14, 21]

export interface SweepResult {
  relances: number
  triggered: number
  /** Pushs partis (échéance du jour, relance 1, fin de pause). */
  pushes: number
  /** Pauses arrivées à leur terme, reprises. */
  resumed: number
}

type OwnerRow = { id: string; user_id: string; users: { email: string; full_name: string; language: string } }

function localeOf(row: OwnerRow): Locale {
  return row.users.language === 'en' ? 'en' : 'fr'
}

async function push(row: OwnerRow, type: PushType): Promise<number> {
  const r = await pushService().send({ userId: row.user_id, type, locale: localeOf(row) })
  return r.sent ? 1 : 0
}

async function relanceIntervals(): Promise<number[]> {
  const row = await prisma().app_config.findUnique({ where: { key: 'dms.relance_intervals_days' }, select: { value: true } })
  try {
    const parsed: unknown = row ? JSON.parse(row.value) : null
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((n) => Number.isInteger(n) && n >= 0)) {
      return (parsed as number[]).slice(0, MAX_RELANCES)
    }
  } catch {
    // valeur illisible : défaut
  }
  return DEFAULT_INTERVALS
}

export async function sweep(now = new Date()): Promise<SweepResult> {
  const intervals = await relanceIntervals()
  const overdue = await prisma().transmission_configs.findMany({
    where: { status: 'active', next_checkin_due: { lt: now } },
    select: {
      id: true,
      user_id: true,
      next_checkin_due: true,
      relance_count: true,
      silence_duration_months: true,
      users: { select: { email: true, full_name: true, language: true } },
    },
  })

  const result: SweepResult = { relances: 0, triggered: 0, pushes: 0, resumed: 0 }
  for (const cfg of overdue) {
    const overdueDays = Math.floor((now.getTime() - cfg.next_checkin_due!.getTime()) / DAY_MS)
    const n = cfg.relance_count

    // E4-US01 : le premier balayage après l'échéance pousse l'invitation au jeu.
    if (overdueDays === 0 && n === 0) result.pushes += await push(cfg, 'checkin_due')

    if (n < intervals.length) {
      if (overdueDays < intervals[n]!) continue
      await sendRelance(cfg, n + 1, now)
      result.relances++
      // E4-US02 : relance 1 = push + email.
      if (n === 0) result.pushes += await push(cfg, 'checkin_relance_1')
      continue
    }

    if (overdueDays >= cfg.silence_duration_months * MONTH_DAYS) {
      await prisma().transmission_configs.update({ where: { id: cfg.id }, data: { status: 'triggered' } })
      result.triggered++
    }
  }

  await sweepPauses(now, result)
  return result
}

/** E4-US04 / E6-US04 : rappel à J-3 (email + push), puis reprise quand la pause est passée. */
async function sweepPauses(now: Date, result: SweepResult): Promise<void> {
  const paused = await prisma().transmission_configs.findMany({
    where: { status: 'paused', pause_until: { not: null } },
    select: {
      id: true,
      user_id: true,
      pause_until: true,
      checkin_frequency_weeks: true,
      users: { select: { email: true, full_name: true, language: true } },
    },
  })
  for (const cfg of paused) {
    const remainingDays = Math.ceil((cfg.pause_until!.getTime() - now.getTime()) / DAY_MS)
    if (remainingDays <= 0) {
      await prisma().transmission_configs.update({
        where: { id: cfg.id },
        data: {
          status: 'active',
          paused_at: null,
          pause_until: null,
          last_checkin_at: now,
          next_checkin_due: new Date(now.getTime() + cfg.checkin_frequency_weeks * WEEK_MS),
          relance_count: 0,
          last_relance_at: null,
        },
      })
      result.resumed++
      continue
    }
    if (remainingDays === PAUSE_REMINDER_DAYS) {
      await emailService().send({
        userId: cfg.user_id,
        to: cfg.users.email,
        type: 'pause_ending',
        locale: localeOf(cfg),
        params: { name: cfg.users.full_name, date: cfg.pause_until!.toISOString().slice(0, 10), link: `${env().FRONTEND_URL}/transmission` },
      })
      result.pushes += await push(cfg, 'pause_ending')
    }
  }
}

async function sendRelance(
  cfg: { id: string; user_id: string; users: { email: string; full_name: string; language: string } },
  number: number,
  now: Date,
): Promise<void> {
  const { logId } = await emailService().send({
    userId: cfg.user_id,
    to: cfg.users.email,
    type: `checkin_relance_${number}` as EmailType,
    locale: cfg.users.language === 'en' ? 'en' : 'fr',
    params: { name: cfg.users.full_name, link: `${env().FRONTEND_URL}/checkin` },
  })
  await prisma().$transaction([
    prisma().checkin_relances.create({
      data: { user_id: cfg.user_id, transmission_id: cfg.id, relance_number: number, sent_at: now, email_log_id: logId },
    }),
    prisma().transmission_configs.update({ where: { id: cfg.id }, data: { relance_count: number, last_relance_at: now } }),
  ])
}

// --- Déclenchement : ouvrir les transmissions des configs 'triggered' ------------

export interface TriggerResult {
  transmissions: number
  contacts_notified: number
}

/** Une config 'triggered' sans ligne `transmissions` est une transmission à ouvrir. Idempotent. */
export async function trigger(now = new Date()): Promise<TriggerResult> {
  const pending = await prisma().transmission_configs.findMany({
    where: { status: 'triggered', transmissions: { none: {} } },
    select: { id: true },
  })
  const result: TriggerResult = { transmissions: 0, contacts_notified: 0 }
  for (const cfg of pending) {
    result.contacts_notified += await startTransmission(cfg.id, now)
    result.transmissions++
  }
  return result
}

/** Le job quotidien : relances et déclenchements, puis ouverture des transmissions. */
export async function runDeadman(now = new Date()): Promise<SweepResult & TriggerResult> {
  const swept = await sweep(now)
  const opened = await trigger(now)
  return { ...swept, ...opened }
}
