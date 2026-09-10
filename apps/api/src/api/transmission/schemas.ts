const base64 = { type: 'string', pattern: '^[A-Za-z0-9+/_-]+={0,2}$' } as const
const uuid = { type: 'string', format: 'uuid' } as const

const roles = {
  type: 'object',
  required: ['k1', 'k2', 'k3'],
  additionalProperties: false,
  properties: { k1: { type: 'boolean' }, k2: { type: 'boolean' }, k3: { type: 'boolean' } },
} as const
export interface Roles {
  k1: boolean
  k2: boolean
  k3: boolean
}

export const contactBody = {
  type: 'object',
  required: ['notification_enc', 'notification_sig', 'secret_enc', 'roles', 'question_ids'],
  additionalProperties: false,
  properties: {
    /** crypto_box_seal(relais_pk, { email, phone }) — DEC-12 niveau 1. */
    notification_enc: { ...base64, maxLength: 2048 },
    /** Ed25519.sign(notification_enc, owner_sk) — 64 bytes. */
    notification_sig: { ...base64, maxLength: 128 },
    /** XChaCha20(K2, { nom, rôle, message_personnel }) — niveau 2, opaque. */
    secret_enc: { ...base64, maxLength: 65536 },
    roles,
    /** DEC-20 : 3 références vers checkin_questions. */
    question_ids: { type: 'array', minItems: 3, maxItems: 3, items: uuid },
  },
} as const
export interface ContactBody {
  notification_enc: string
  notification_sig: string
  secret_enc: string
  roles: Roles
  question_ids: [string, string, string]
}

export const contactParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: uuid },
} as const
export interface ContactParams {
  id: string
}

/** Schéma N-of-M : N contacts suffisent parmi M (N ≥ 2, M ≥ N — chk transmission_configs). */
export const schemaBody = {
  type: 'object',
  required: ['n', 'm'],
  additionalProperties: false,
  properties: { n: { type: 'integer', minimum: 2 }, m: { type: 'integer', minimum: 2 } },
} as const
export interface SchemaBody {
  n: number
  m: number
}

/** DEC-22 : catalogues fixes (dms.durations_available, dms.checkin_frequencies). */
export const configBody = {
  type: 'object',
  required: ['silence_duration_months', 'checkin_frequency_weeks'],
  additionalProperties: false,
  properties: {
    silence_duration_months: { type: 'integer', enum: [1, 3, 6] },
    checkin_frequency_weeks: { type: 'integer', enum: [1, 2, 4] },
  },
} as const
export interface ConfigBody {
  silence_duration_months: 1 | 3 | 6
  checkin_frequency_weeks: 1 | 2 | 4
}
