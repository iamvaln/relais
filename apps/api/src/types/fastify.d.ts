import type { Plan, StepUpAction } from '../lib/jwt.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Renseigné par `authenticate`. */
    user?: AuthenticatedUser
    /** Renseigné par `requireStepUp` une fois le jti consommé. */
    stepUp?: { action: StepUpAction; jti: string }
  }
}

export interface AuthenticatedUser {
  id: string
  /** Session courante (claim `sid` de l'access token). */
  sessionId: string
  plan: Plan
  language: 'fr' | 'en'
  emailVerified: boolean
  totpEnabled: boolean
}
