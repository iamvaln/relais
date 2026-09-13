// Check-in (E4-US01, E4-US05) : le jeu et la preuve de vie vivent côté
// serveur (docs/backend.md) ; l'app ne fait que jouer et valider.

import type { ApiClient } from '@relais/api-client'
import type { SigningKeypair } from '@relais/crypto-core'
import { chainFieldFor, type ChainField } from '../chain.js'
import type { TransmissionConfig } from '../transmission/service.js'

export interface CheckinStatus {
  transmission_status: string
  checkin_frequency_weeks: number
  next_checkin_due: string | null
  last_checkin_at: string | null
  overdue_days: number
  relance_count: number
  checked_in_this_month: boolean
}

export interface CheckinGame {
  game_id: string
  game_type: 'riddle' | 'sequence' | 'sort'
  prompt: string
  choices: string[] | null
  attempts: number
}

export type CheckinAnswer = { correct: false; attempts: number } | { correct: true; attempts: number; checkin_token: string }

export interface CheckinDone {
  checked_in: true
  month: string
  streak: number
  badge_earned: string | null
  already_this_month: boolean
  next_checkin_due: string
}

export interface CheckinLogEntry {
  id: string
  month: string
  game_type: string
  attempts: number
  streak: number
  badge_earned: string | null
  journal_entry_id: string | null
  completed_at: string
}

export interface CheckinStreak {
  current: number
  longest: number
  badges: string[]
}

/** Lot 3a : de quoi signer le check-in pour la chaîne — la clé du seed et la config (sujet, fréquence, schéma, contacts). */
export interface CheckinChainDeps {
  signer: () => SigningKeypair
  config: () => Promise<TransmissionConfig>
}

export class Checkin {
  constructor(
    private readonly api: ApiClient,
    private readonly chain?: CheckinChainDeps,
  ) {}

  status(): Promise<CheckinStatus> {
    return this.api.get('/checkin/status')
  }

  game(): Promise<CheckinGame> {
    return this.api.get('/checkin/game')
  }

  answer(answer: string): Promise<CheckinAnswer> {
    return this.api.post('/checkin/game/answer', { answer })
  }

  /**
   * Valide le check-in. Lot 3a : signé pour la chaîne quand un signer est
   * fourni — `checkin` sur un compte enregistré, `register` sinon (un compte
   * activé avant la chaîne s'enregistre à son premier check-in).
   */
  async complete(checkinToken: string, journalEntryId?: string): Promise<CheckinDone> {
    let chain: ChainField | undefined
    if (this.chain) {
      const cfg = await this.chain.config()
      chain = await chainFieldFor(this.chain.signer(), cfg.chain.subject, 'checkin', {
        checkinFrequencyWeeks: cfg.checkin_frequency_weeks,
        previousDue: cfg.next_checkin_due,
        register: { n: cfg.schema.n, m: cfg.contacts.length, silenceMonths: cfg.silence_duration_months },
      })
    }
    return this.api.post('/checkin/complete', { checkin_token: checkinToken, ...(journalEntryId ? { journal_entry_id: journalEntryId } : {}), ...(chain ? { chain } : {}) })
  }

  history(): Promise<CheckinLogEntry[]> {
    return this.api.get('/checkin/history')
  }

  streak(): Promise<CheckinStreak> {
    return this.api.get('/checkin/streak')
  }
}
