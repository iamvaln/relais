export const VAULT_CATEGORIES = ['accounts', 'messages', 'finances'] as const
export type VaultCategory = (typeof VAULT_CATEGORIES)[number]

const category = { type: 'string', enum: [...VAULT_CATEGORIES] } as const
const base64 = { type: 'string', pattern: '^[A-Za-z0-9+/_-]+={0,2}$' } as const

export const syncBody = {
  type: 'object',
  required: ['category', 'payload', 'signature'],
  additionalProperties: false,
  properties: {
    category,
    /** P2 = XChaCha20(Ki, P1), chiffré côté client. Le serveur ne le lit pas. */
    payload: { ...base64, maxLength: 96 * 1024 * 1024 },
    /** Ed25519.sign(SHA256(payload), ed25519_sk) — 64 bytes. */
    signature: { ...base64, maxLength: 128 },
  },
} as const
export interface SyncBody {
  category: VaultCategory
  payload: string
  signature: string
}

export const restoreBody = {
  type: 'object',
  required: ['category'],
  additionalProperties: false,
  properties: { category },
} as const
export interface RestoreBody {
  category: VaultCategory
}
