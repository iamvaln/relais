// Enveloppe de l'API : { success: true, data } | { success: false, error: { code, message, details } }.

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

/** Réseau coupé, DNS, timeout : pas une réponse de l'API. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Impossible de joindre Relais')
    this.name = 'NetworkError'
    this.cause = cause
  }
}
