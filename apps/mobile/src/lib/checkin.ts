// Check-in et carnet, sans jargon (E4-US01, E4-US05) : pur, testé sous Node.

import type { CheckinStatus } from '@relais/app-core'
import { type Language, type MessageKey, t } from '../i18n'

const fmt = (lang: Language, iso: string) => new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')

export function checkinLine(lang: Language, s: Pick<CheckinStatus, 'transmission_status' | 'checked_in_this_month' | 'next_checkin_due' | 'overdue_days'>): string {
  if (s.transmission_status === 'paused') return t(lang, 'checkin.line.paused')
  if (s.transmission_status !== 'active' || !s.next_checkin_due) return t(lang, 'checkin.line.inactive')
  if (s.overdue_days > 0) return t(lang, 'checkin.line.overdue', { days: s.overdue_days })
  if (s.checked_in_this_month) return t(lang, 'checkin.line.done', { date: fmt(lang, s.next_checkin_due) })
  return t(lang, 'checkin.line.due', { date: fmt(lang, s.next_checkin_due) })
}

const BADGES = new Set(['first_checkin', 'streak_3', 'streak_6', 'streak_12'])

export function badgeKey(badge: string): MessageKey {
  return (BADGES.has(badge) ? `badge.${badge}` : 'badge.unknown') as MessageKey
}

/** Une notification n'ouvre que les écrans qu'elle a le droit d'ouvrir. */
const PUSH_ROUTES = new Set(['/checkin', '/transmission'])

export function routeForNotification(data: unknown): '/checkin' | '/transmission' | '/home' {
  const route = (data as { route?: unknown } | undefined)?.route
  return typeof route === 'string' && PUSH_ROUTES.has(route) ? (route as '/checkin' | '/transmission') : '/home'
}
