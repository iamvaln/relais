export type Locale = 'fr' | 'en'

/**
 * Types d'email — doivent correspondre au CHECK de email_log.email_type.
 * Les cinq derniers ne figuraient pas dans la spec v1.3 mais sont exigés par
 * les user stories (E6-US01, E6-US03, E6-US02, Backend §2.5) ; ajoutés par la
 * migration 20260425000000.
 */
export type EmailType =
  | 'otp_registration'
  | 'otp_email_change'
  | 'otp_password_reset'
  | 'checkin_relance_1'
  | 'checkin_relance_2'
  | 'checkin_relance_3'
  | 'transmission_contact'
  | 'account_suspended'
  | 'account_unblocked'
  | 'subscription_expiring'
  | 'subscription_expired'
  | 'account_locked'
  | 'password_changed'
  | 'restore_succeeded'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  // v1.4 (Point-1) et Proposal-9 — migration 20260911000000
  | 'contact_designated'
  | 'contact_progress'
  // Lot 5 mobile (E4-US04) — migration 20260912000000
  | 'pause_ending'

export interface RenderedEmail {
  subject: string
  text: string
}

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
}

export interface EmailTransport {
  readonly name: 'console' | 'resend'
  send(msg: OutgoingEmail): Promise<{ providerId: string | null }>
}

export interface SendOptions {
  /** Utilisateur concerné, s'il existe déjà (NULL à l'inscription). */
  userId?: string | null
  to: string
  type: EmailType
  locale: Locale
  params?: Record<string, string>
}
