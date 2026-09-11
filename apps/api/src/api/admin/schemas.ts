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

export const transmissionListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['triggered', 'in_progress', 'completed', 'cancelled', 'expired'] },
    page: { type: 'string', pattern: '^[0-9]{1,4}$' },
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
  },
} as const
export interface TransmissionListQuery {
  status?: string
  page?: string
  limit?: string
}

export const extendEscrowBody = {
  type: 'object',
  required: ['hours', 'reason'],
  additionalProperties: false,
  properties: {
    /** BO-02 : +24 h ou +48 h. */
    hours: { type: 'integer', enum: [24, 48] },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const
export interface ExtendEscrowBody {
  hours: 24 | 48
  reason: string
}

export const contactParams = {
  type: 'object',
  required: ['id', 'cid'],
  additionalProperties: false,
  properties: { id: uuid, cid: uuid },
} as const
export interface ContactParams {
  id: string
  cid: string
}

export const QUESTION_CATEGORIES = [
  'childhood', 'places', 'events', 'people', 'habits', 'shared_memory', 'other',
  'month_memory', 'relations', 'work', 'gratitude', 'introspection', 'legacy', 'lightness',
] as const

const questionFields = {
  text_fr: { type: 'string', minLength: 5, maxLength: 500 },
  text_en: { type: 'string', minLength: 5, maxLength: 500 },
  category: { type: 'string', enum: [...QUESTION_CATEGORIES] },
  usage_type: { type: 'string', enum: ['secret_question', 'journal', 'both'] },
  reliability_score: { type: 'integer', minimum: 1, maximum: 10 },
  risk_notes: { type: 'string', maxLength: 2000 },
  cycle_month: { type: 'integer', minimum: 1, maximum: 12 },
  mode_target: { type: 'string', enum: ['essential', 'reflective', 'all'] },
} as const

export const questionCreateBody = {
  type: 'object',
  required: ['text_fr', 'text_en', 'category', 'usage_type', 'reliability_score'],
  additionalProperties: false,
  properties: questionFields,
} as const
export interface QuestionCreateBody {
  text_fr: string
  text_en: string
  category: string
  usage_type: 'secret_question' | 'journal' | 'both'
  reliability_score: number
  risk_notes?: string
  cycle_month?: number
  mode_target?: 'essential' | 'reflective' | 'all'
}

export const questionUpdateBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { ...questionFields, status: { type: 'string', enum: ['active', 'review'] } },
} as const
export interface QuestionUpdateBody extends Partial<QuestionCreateBody> {
  status?: 'active' | 'review'
}

export const questionListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    usage_type: { type: 'string', enum: ['secret_question', 'journal', 'both'] },
    status: { type: 'string', enum: ['active', 'archived', 'review'] },
    category: { type: 'string', enum: [...QUESTION_CATEGORIES] },
  },
} as const
export interface QuestionListQuery {
  usage_type?: string
  status?: string
  category?: string
}

export const configKeyParams = {
  type: 'object',
  required: ['key'],
  additionalProperties: false,
  properties: { key: { type: 'string', pattern: '^[a-z_]+\\.[a-z_]+$', maxLength: 64 } },
} as const
export interface ConfigKeyParams {
  key: string
}

export const configUpdateBody = {
  type: 'object',
  required: ['value'],
  additionalProperties: false,
  properties: { value: {}, reason: { type: 'string', maxLength: 500 } },
} as const
export interface ConfigUpdateBody {
  value: unknown
  reason?: string
}

export const auditListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', maxLength: 40 },
    admin_id: uuid,
    target_id: { type: 'string', maxLength: 128 },
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
    page: { type: 'string', pattern: '^[0-9]{1,4}$' },
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
  },
} as const
export interface AuditListQuery {
  action?: string
  admin_id?: string
  target_id?: string
  from?: string
  to?: string
  page?: string
  limit?: string
}

export const planChangeBody = {
  type: 'object',
  required: ['plan', 'reason'],
  additionalProperties: false,
  properties: {
    plan: { type: 'string', enum: ['free', 'premium'] },
    /** Montant encaissé (Mobile Money, hors app) ; défaut billing.premium_price_fcfa. */
    amount_fcfa: { type: 'integer', minimum: 1, maximum: 100000000 },
    provider_ref: { type: 'string', maxLength: 128 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const
export interface PlanChangeBody {
  plan: 'free' | 'premium'
  amount_fcfa?: number
  provider_ref?: string
  reason: string
}

export const extendBody = {
  type: 'object',
  required: ['days', 'reason'],
  additionalProperties: false,
  properties: { days: { type: 'integer', minimum: 1, maximum: 365 }, reason: { type: 'string', minLength: 1, maxLength: 500 } },
} as const
export interface ExtendBody {
  days: number
  reason: string
}

export const subscriptionListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    plan: { type: 'string', enum: ['free', 'premium'] },
    status: { type: 'string', enum: ['active', 'grace', 'expired', 'cancelled'] },
    page: { type: 'string', pattern: '^[0-9]{1,4}$' },
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
  },
} as const
export interface SubscriptionListQuery {
  plan?: string
  status?: string
  page?: string
  limit?: string
}
