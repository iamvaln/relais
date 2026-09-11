export const JOURNAL_MODES = ['essential', 'reflective', 'free'] as const
export type JournalMode = (typeof JOURNAL_MODES)[number]

export const questionQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { mode: { type: 'string', enum: [...JOURNAL_MODES] } },
} as const
export interface QuestionQuery {
  mode?: JournalMode
}

const base64 = { type: 'string', pattern: '^[A-Za-z0-9+/_-]+={0,2}$' } as const
const uuid = { type: 'string', format: 'uuid' } as const
const monthDate = { type: 'string', pattern: '^\\d{4}-\\d{2}-01$' } as const

const entryFields = {
  /** XChaCha20(K2, { question_id, mois, mode, texte }) — opaque. */
  content_enc: { ...base64, maxLength: 65536 },
  /** DEC-31 : Ed25519.sign(SHA256(content_enc), owner_sk). */
  signature: { ...base64, maxLength: 128 },
  mode: { type: 'string', enum: [...JOURNAL_MODES] },
  question_id: uuid,
  word_count_approx: { type: 'integer', minimum: 0, maximum: 100000 },
} as const

export const entryBody = {
  type: 'object',
  required: ['content_enc', 'signature', 'mode'],
  additionalProperties: false,
  properties: { ...entryFields, entry_month: monthDate },
} as const
export interface EntryBody {
  content_enc: string
  signature: string
  mode: JournalMode
  question_id?: string
  word_count_approx?: number
  entry_month?: string
}

export const entryUpdateBody = {
  type: 'object',
  required: ['content_enc', 'signature'],
  additionalProperties: false,
  properties: entryFields,
} as const
export interface EntryUpdateBody {
  content_enc: string
  signature: string
  mode?: JournalMode
  question_id?: string
  word_count_approx?: number
}

/** DEC-31 : Ed25519.sign(SHA256(id en UTF-8), owner_sk). */
export const entryDeleteBody = {
  type: 'object',
  required: ['signature'],
  additionalProperties: false,
  properties: { signature: { ...base64, maxLength: 128 } },
} as const
export interface EntryDeleteBody {
  signature: string
}

export const entryParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: uuid },
} as const
export interface EntryParams {
  id: string
}

/** Année du Wrapped, en 4 chiffres ; bornes (2026 → année courante) vérifiées en service — les params ne sont pas coercés. */
export const yearParams = {
  type: 'object',
  required: ['year'],
  additionalProperties: false,
  properties: { year: { type: 'string', pattern: '^[0-9]{4}$' } },
} as const
export interface YearParams {
  year: string
}

export const wrappedBody = {
  type: 'object',
  required: ['stats_enc', 'signature'],
  additionalProperties: false,
  properties: {
    /** XChaCha20(K2, stats agrégées) — calculé localement. */
    stats_enc: { ...base64, maxLength: 16384 },
    /** DEC-31 : Ed25519.sign(SHA256(stats_enc), owner_sk). */
    signature: { ...base64, maxLength: 128 },
  },
} as const
export interface WrappedBody {
  stats_enc: string
  signature: string
}
