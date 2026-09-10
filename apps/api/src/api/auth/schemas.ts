// Schémas JSON des corps de requête (Backend Specs §7.3).
// `additionalProperties: false` partout : un champ inattendu est refusé.

import { STEP_UP_ACTIONS } from '../../lib/jwt.js'

const email = { type: 'string', format: 'email', maxLength: 255 } as const
/** E1-US01 : 10 caractères minimum, complexité vérifiée dans le service. */
const password = { type: 'string', minLength: 10, maxLength: 128 } as const
const otpCode = { type: 'string', pattern: '^[0-9]{6}$' } as const
const base64 = { type: 'string', pattern: '^[A-Za-z0-9+/_-]+={0,2}$', maxLength: 512 } as const
const uuid = { type: 'string', format: 'uuid' } as const

export const registerBody = {
  type: 'object',
  required: ['full_name', 'email', 'phone', 'password'],
  additionalProperties: false,
  properties: {
    full_name: { type: 'string', minLength: 2, maxLength: 160 },
    email,
    phone: { type: 'string', minLength: 6, maxLength: 32 },
    password,
    language: { type: 'string', enum: ['fr', 'en'] },
  },
} as const
export interface RegisterBody {
  full_name: string
  email: string
  phone: string
  password: string
  language?: 'fr' | 'en'
}

export const emailVerifyBody = {
  type: 'object',
  required: ['email', 'code'],
  additionalProperties: false,
  properties: { email, code: otpCode },
} as const
export interface EmailVerifyBody {
  email: string
  code: string
}

export const emailOnlyBody = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: { email },
} as const
export interface EmailOnlyBody {
  email: string
}

export const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: { email, password: { type: 'string', minLength: 1, maxLength: 128 } },
} as const
export interface LoginBody {
  email: string
  password: string
}

export const stepUpBody = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: { action: { type: 'string', enum: [...STEP_UP_ACTIONS] } },
} as const
export interface StepUpBody {
  action: (typeof STEP_UP_ACTIONS)[number]
}

export const keysBody = {
  type: 'object',
  required: ['ed25519_pk'],
  additionalProperties: false,
  properties: { ed25519_pk: base64 },
} as const
export interface KeysBody {
  ed25519_pk: string
}

export const changePasswordBody = {
  type: 'object',
  required: ['current_password', 'new_password'],
  additionalProperties: false,
  properties: { current_password: { type: 'string', minLength: 1, maxLength: 128 }, new_password: password },
} as const
export interface ChangePasswordBody {
  current_password: string
  new_password: string
}

export const restoreVerifyBody = {
  type: 'object',
  required: ['challenge_id', 'signature'],
  additionalProperties: false,
  properties: { challenge_id: uuid, signature: base64 },
} as const
export interface RestoreVerifyBody {
  challenge_id: string
  signature: string
}

export const passwordResetBody = {
  type: 'object',
  required: ['email', 'code', 'new_password'],
  additionalProperties: false,
  properties: { email, code: otpCode, new_password: password, signature: base64 },
} as const
export interface PasswordResetBody {
  email: string
  code: string
  new_password: string
  /** Ed25519.sign(message de reset) — requis dès que le compte a une clé publique. */
  signature?: string
}

export const twoFactorVerifyBody = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: { code: otpCode, temp_token: { type: 'string', minLength: 16, maxLength: 128 } },
} as const
export interface TwoFactorVerifyBody {
  code: string
  temp_token?: string
}

export const twoFactorDisableBody = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: { code: otpCode },
} as const
export interface TwoFactorDisableBody {
  code: string
}
