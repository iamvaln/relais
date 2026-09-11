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

const uuid = { type: 'string', format: 'uuid' } as const

export const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: uuid },
} as const
export interface IdParams {
  id: string
}

export const reasonBody = {
  type: 'object',
  required: ['reason'],
  additionalProperties: false,
  properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } },
} as const
export interface ReasonBody {
  reason: string
}

export const userListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search: { type: 'string', maxLength: 100 },
    plan: { type: 'string', enum: ['free', 'premium'] },
    status: { type: 'string', enum: ['pending_verification', 'active', 'suspended', 'deleted'] },
    transmission: { type: 'string', enum: ['inactive', 'active', 'paused', 'triggered', 'completed'] },
    created_from: { type: 'string', format: 'date' },
    created_to: { type: 'string', format: 'date' },
    page: { type: 'string', pattern: '^[0-9]{1,4}$' },
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
  },
} as const
export interface UserListQuery {
  search?: string
  plan?: 'free' | 'premium'
  status?: string
  transmission?: string
  created_from?: string
  created_to?: string
  page?: string
  limit?: string
}

export const emailChangeBody = {
  type: 'object',
  required: ['email', 'reason'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const
export interface EmailChangeBody {
  email: string
  reason: string
}

export const otpRegenBody = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: { email: { type: 'string', format: 'email', maxLength: 254 } },
} as const
export interface OtpRegenBody {
  email: string
}
