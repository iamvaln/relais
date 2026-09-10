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

const share = {
  type: 'object',
  required: ['enc', 'sig'],
  additionalProperties: false,
  properties: {
    /** Si_enc = XChaCha20(K_i, S_i) — opaque pour le serveur. */
    enc: { ...base64, maxLength: 4096 },
    /** Ed25519.sign(SHA256(Si_enc), owner_sk) — DEC-29. */
    sig: { ...base64, maxLength: 128 },
  },
} as const
const shareOrNull = { anyOf: [share, { type: 'null' }] } as const
export interface Share {
  enc: string
  sig: string
}

export const activateBody = {
  type: 'object',
  required: ['silence_duration_months', 'checkin_frequency_weeks', 'schema', 'contacts'],
  additionalProperties: false,
  properties: {
    ...configBody.properties,
    schema: schemaBody,
    contacts: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        required: [...contactBody.required, 'id', 'shares', 'verify_token'],
        additionalProperties: false,
        properties: {
          ...contactBody.properties,
          id: uuid,
          /** Une part par rôle détenu, null sinon. Le serveur choisit le chemin Storj et calcule le hash. */
          shares: {
            type: 'object',
            required: ['k1', 'k2', 'k3'],
            additionalProperties: false,
            properties: { k1: shareOrNull, k2: shareOrNull, k3: shareOrNull },
          },
          /** XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1') — vérification annuelle. */
          verify_token: { ...base64, maxLength: 256 },
        },
      },
    },
  },
} as const
export interface ActivateContact extends ContactBody {
  id: string
  shares: { k1: Share | null; k2: Share | null; k3: Share | null }
  verify_token: string
}
export interface ActivateBody extends ConfigBody {
  schema: SchemaBody
  contacts: ActivateContact[]
}

/** E4-US04 : 1 semaine / 1 mois / 3 mois, plafonné par dms.pause_max_months. */
export const pauseBody = {
  type: 'object',
  required: ['duration_days'],
  additionalProperties: false,
  properties: { duration_days: { type: 'integer', enum: [7, 30, 90] } },
} as const
export interface PauseBody {
  duration_days: 7 | 30 | 90
}

/** Vérification annuelle : Ed25519.sign(SHA256(verify_token), owner_sk). */
export const verifyBody = {
  type: 'object',
  required: ['signature'],
  additionalProperties: false,
  properties: { signature: { ...base64, maxLength: 128 } },
} as const
export interface VerifyBody {
  signature: string
}
