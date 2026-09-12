// Check-in (E4-US01, E4-US05) : le jeu et la preuve de vie vivent côté
// serveur (docs/backend.md) ; l'app ne fait que jouer et valider.

import type { ApiClient } from '@relais/api-client'

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

export class Checkin {
  constructor(private readonly api: ApiClient) {}

  status(): Promise<CheckinStatus> {
    return this.api.get('/checkin/status')
  }

  game(): Promise<CheckinGame> {
    return this.api.get('/checkin/game')
  }

  answer(answer: string): Promise<CheckinAnswer> {
    return this.api.post('/checkin/game/answer', { answer })
  }

  complete(checkinToken: string, journalEntryId?: string): Promise<CheckinDone> {
    return this.api.post('/checkin/complete', { checkin_token: checkinToken, ...(journalEntryId ? { journal_entry_id: journalEntryId } : {}) })
  }

  history(): Promise<CheckinLogEntry[]> {
    return this.api.get('/checkin/history')
  }

  streak(): Promise<CheckinStreak> {
    return this.api.get('/checkin/streak')
  }
}
