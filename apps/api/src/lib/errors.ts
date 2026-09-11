// Codes d'erreur standardisés (Backend Specs §6.2) et format de réponse (§6.1).
//
//   { success: true,  data: {...} }
//   { success: false, error: { code, message, details? } }

export const ErrorCodes = {
  AUTH_INVALID_CREDENTIALS: { http: 401, message: 'Email ou mot de passe incorrect.' },
  AUTH_ACCOUNT_LOCKED: { http: 423, message: 'Compte verrouillé — trop de tentatives.' },
  AUTH_TOKEN_EXPIRED: { http: 401, message: 'Token expiré — renouvellement requis.' },
  AUTH_TOKEN_INVALID: { http: 401, message: 'Token invalide ou malformé.' },
  AUTH_2FA_REQUIRED: { http: 403, message: 'Double authentification requise.' },
  AUTH_2FA_INVALID: { http: 401, message: 'Code de double authentification incorrect.' },
  AUTH_STEPUP_REQUIRED: { http: 403, message: 'Confirmation par PIN requise pour cette action.' },
  AUTH_STEPUP_INVALID: { http: 403, message: 'Step-up token invalide, expiré ou déjà utilisé.' },
  AUTH_EMAIL_NOT_VERIFIED: { http: 403, message: 'Email non vérifié.' },
  AUTH_OTP_INVALID: { http: 401, message: 'Code de vérification incorrect ou expiré.' },
  AUTH_OTP_EXHAUSTED: { http: 429, message: 'Trop de tentatives — demandez un nouveau code.' },
  AUTH_ACCOUNT_SUSPENDED: { http: 403, message: 'Compte suspendu. Contactez le support.' },
  AUTH_RESTORE_FAILED: { http: 401, message: 'Les 12 mots ne correspondent pas à ce compte.' },
  AUTH_KEY_ALREADY_SET: { http: 409, message: 'La clé publique de ce compte est déjà enregistrée.' },
  AUTH_KEY_NOT_SET: { http: 409, message: "Ce compte n'a pas encore de clé publique." },
  VAULT_SYNC_FAILED: { http: 503, message: 'Échec de synchronisation du coffre.' },
  TRANSMISSION_NOT_CONFIGURED: { http: 409, message: 'Transmission non configurée.' },
  TRANSMISSION_ALREADY_ACTIVE: { http: 409, message: 'Transmission déjà active.' },
  RELAY_TOKEN_INVALID: { http: 404, message: 'Lien invalide ou expiré.' },
  RELAY_TOKEN_EXHAUSTED: { http: 429, message: 'Trop de tentatives sur ce lien.' },
  RELAY_CONTACT_BLOCKED: { http: 423, message: 'Contact bloqué — trop d’échecs.' },
  RELAY_ALREADY_ANSWERED: { http: 409, message: 'Ce contact a déjà répondu.' },
  JOURNAL_MONTH_TAKEN: { http: 409, message: 'Une entrée existe déjà pour ce mois — modifiez-la.' },
  RELAY_NOT_UNLOCKED: { http: 409, message: 'Accès pas encore déverrouillé — en attente des autres contacts.' },
  PLAN_LIMIT_REACHED: { http: 403, message: 'Limite du plan atteinte.' },
  NOT_FOUND: { http: 404, message: 'Ressource introuvable.' },
  VALIDATION_ERROR: { http: 400, message: 'Données invalides.' },
  RATE_LIMITED: { http: 429, message: 'Trop de requêtes. Réessayez plus tard.' },
  INTERNAL_ERROR: { http: 500, message: 'Erreur interne.' },
} as const

export type ErrorCode = keyof typeof ErrorCodes

export class AppError extends Error {
  readonly code: ErrorCode
  readonly http: number
  readonly details: unknown

  constructor(code: ErrorCode, options: { message?: string; details?: unknown; cause?: unknown } = {}) {
    super(options.message ?? ErrorCodes[code].message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'AppError'
    this.code = code
    this.http = ErrorCodes[code].http
    this.details = options.details
  }

  toBody(): ErrorBody {
    const error: ErrorBody['error'] = { code: this.code, message: this.message }
    if (this.details !== undefined) error.details = this.details
    return { success: false, error }
  }
}

export interface SuccessBody<T> {
  success: true
  data: T
}

export interface ErrorBody {
  success: false
  error: { code: ErrorCode; message: string; details?: unknown }
}

export function ok<T>(data: T): SuccessBody<T> {
  return { success: true, data }
}
