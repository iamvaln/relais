import type { KeySlot } from '@relais/crypto-core'

export type Roles = Record<KeySlot, boolean>
export type QuestionIds = [string, string, string]
export type Answers = [string, string, string]

/** Ce que l'owner saisit pour un contact. Réponses : null tant qu'elles ne sont pas connues sur ce device. */
export interface ContactInput {
  name: string
  email: string
  phone: string | null
  /** E2-US05 : message personnel, texte libre. */
  message: string
  roles: Roles
  questionIds: QuestionIds
  answers: Answers | null
}

export interface Contact extends ContactInput {
  /** Identifiant local (base du device). */
  id: string
  /** Identifiant du contact chez Relais une fois créé par POST /transmission/contacts. */
  serverId: string | null
  position: number
  created_at: number
  updated_at: number
}

export const ROLE_SLOTS: KeySlot[] = ['k1', 'k2', 'k3']
