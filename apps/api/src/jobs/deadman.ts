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
// Pure au sens utile : l'horloge est injectée, aucune file d'attente ici.

import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { emailService, type EmailType } from '../services/email/index.js'
import { startTransmission } from '../api/relay/service.js'

const DAY_MS = 24 * 3600 * 1000
const MONTH_DAYS = 30
const MAX_RELANCES = 3 // chk relance_count BETWEEN 0 AND 3
const DEFAULT_INTERVALS = [7, 14, 21]

export interface SweepResult {
  relances: number
  triggered: number
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

  const result: SweepResult = { relances: 0, triggered: 0 }
  for (const cfg of overdue) {
    const overdueDays = Math.floor((now.getTime() - cfg.next_checkin_due!.getTime()) / DAY_MS)
    const n = cfg.relance_count

    if (n < intervals.length) {
      if (overdueDays < intervals[n]!) continue
      await sendRelance(cfg, n + 1, now)
      result.relances++
      continue
    }

    if (overdueDays >= cfg.silence_duration_months * MONTH_DAYS) {
      await prisma().transmission_configs.update({ where: { id: cfg.id }, data: { status: 'triggered' } })
      result.triggered++
    }
  }
  return result
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
