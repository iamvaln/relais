export const tokenParams = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: { token: { type: 'string', minLength: 32, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' } },
} as const
export interface TokenParams {
  token: string
}

const base64 = { type: 'string', pattern: '^[A-Za-z0-9+/_-]+={0,2}$', maxLength: 128 } as const

/**
 * Soit l'app déclare un échec local (réponses fausses), soit elle dépose les
 * parts Si déchiffrées pour chaque rôle détenu — jamais les réponses (E5-US02).
 */
export const verifyBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    failed: { type: 'boolean' },
    shares: {
      type: 'object',
      additionalProperties: false,
      properties: { k1: base64, k2: base64, k3: base64 },
    },
  },
} as const
export interface VerifyBody {
  failed?: boolean
  shares?: { k1?: string; k2?: string; k3?: string }
}
