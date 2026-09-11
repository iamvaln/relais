export type VaultCategory = 'accounts' | 'messages' | 'finances'
export const VAULT_CATEGORIES: VaultCategory[] = ['accounts', 'messages', 'finances']

/** E2-US01 : Immédiat / Sous 30 jours / À votre discrétion. */
export type Urgency = 'immediate' | 'within_30_days' | 'discretion'
export const URGENCIES: Urgency[] = ['immediate', 'within_30_days', 'discretion']

export interface VaultItemInput {
  category: VaultCategory
  service_name: string
  login?: string
  password?: string
  instructions?: string
  notes?: string
  urgency: Urgency
}

export interface VaultItem extends VaultItemInput {
  id: string
  created_at: number
  updated_at: number
}

/** Une ligne telle qu'elle est stockée et synchronisée : le payload est P1 (opaque). */
export interface EncryptedRow {
  id: string
  category: VaultCategory
  urgency: Urgency
  payload: string
  created_at: number
  updated_at: number
}

export interface VaultFilter {
  category?: VaultCategory
  urgency?: Urgency
  search?: string
}
