// Ce que les écrans de transmission disent, sans jargon (E3-US01, E3-US05,
// E3-US06) : pur, testé sous Node.

import type { ActivationProblem } from '@relais/app-core'
import { type Language, type MessageKey, t } from '../i18n'

/** E3-US05 : nombre d'occasions de répondre pendant la durée de silence (30 jours par mois, 7 par semaine). */
export function checkinOccasions(silenceMonths: number, frequencyWeeks: number): number {
  return Math.max(1, Math.floor((silenceMonths * 30) / (frequencyWeeks * 7)))
}

/** E3-US01 : « Il faudra que 2 de tes 3 contacts répondent… » */
export function schemaSentence(lang: Language, n: number, m: number): string {
  if (n >= m) return m === 2 ? t(lang, 'transmission.schema.both') : t(lang, 'transmission.schema.allOf', { m })
  return t(lang, 'transmission.schema.sentence', { n, m })
}

export function activationProblemKey(p: ActivationProblem): MessageKey {
  switch (p.code) {
    case 'too_few_contacts':
      return 'transmission.problem.tooFew'
    case 'no_k1_holder':
      return 'transmission.problem.noK1'
    case 'role_holders_below_n':
      return 'transmission.problem.holders'
    case 'schema_m_mismatch':
      return 'transmission.problem.mismatch'
    case 'missing_answers':
      return 'transmission.problem.answers'
  }
}

export function transmissionStatusLine(lang: Language, s: { status: string; pause_until: string | null; contacts: number }): string {
  switch (s.status) {
    case 'inactive':
      return t(lang, s.contacts > 0 ? 'transmission.status.configured' : 'transmission.status.inactive')
    case 'active':
      return t(lang, 'transmission.status.active')
    case 'paused':
      return t(lang, 'transmission.status.paused', { date: s.pause_until ? new Date(s.pause_until).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB') : '?' })
    case 'triggered':
      return t(lang, 'transmission.status.triggered')
    default:
      return t(lang, 'transmission.status.completed')
  }
}
