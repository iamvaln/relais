export const adminLoginBody = {
  type: 'object',
  required: ['email', 'password', 'code'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 1, maxLength: 256 },
    /** TOTP obligatoire (§3.8). */
    code: { type: 'string', pattern: '^[0-9]{6}$' },
  },
} as const
export interface AdminLoginBody {
  email: string
  password: string
  code: string
}
