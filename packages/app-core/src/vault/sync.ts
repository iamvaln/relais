// Synchronisation du coffre avec Storj via l'API (Techniques §5.2, DEC-07,
// Backend v1.1 §3) : « debounced 3 s ». Une catégorie modifiée est marquée ;
// 3 s sans nouvelle modification, ses lignes chiffrées partent en un seul
// blob P2 = seal(Ki, JSON(lignes)) signé Ed25519 sur SHA256(P2).
//
// Le transport est une interface : HTTP (ApiVaultTransport) dans l'app,
// mémoire dans les tests de rythme. Aucun clair ne sort d'ici : les lignes
// sont déjà des P1 opaques.

import type { ApiClient } from '@relais/api-client'
import { type CategoryKeys, type KeySlot, type SigningKeypair, buildSyncPayload, open, wipe } from '@relais/crypto-core'
import type { LocalVault } from './store.js'
import { type EncryptedRow, type VaultCategory, VAULT_CATEGORIES } from './types.js'

export interface SyncPayload {
  category: VaultCategory
  payload: string
  signature: string
}

export type SyncStatus = Record<VaultCategory, { synced_at: string; size: number } | null>

export interface VaultTransport {
  sync(body: SyncPayload): Promise<void>
  restore(category: VaultCategory): Promise<{ payload: string } | null>
  status?(): Promise<SyncStatus>
}

export class ApiVaultTransport implements VaultTransport {
  constructor(private readonly api: ApiClient) {}
  async sync(body: SyncPayload): Promise<void> {
    await this.api.post('/vault/sync', body)
  }
  async restore(category: VaultCategory): Promise<{ payload: string } | null> {
    try {
      return await this.api.post<{ payload: string }>('/vault/restore', { category })
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null
      throw err
    }
  }
  status(): Promise<SyncStatus> {
    return this.api.get('/vault/sync-status')
  }
}

export type Schedule = (fn: () => void, ms: number) => () => void

const SLOT: Record<VaultCategory, KeySlot> = { accounts: 'k1', messages: 'k2', finances: 'k3' }
const DEFAULT_DEBOUNCE_MS = 3000

export interface VaultSyncDeps {
  transport: VaultTransport
  keys: () => CategoryKeys
  signer: () => SigningKeypair
  schedule?: Schedule
  debounceMs?: number
  /** Appelé quand un envoi échoue (réseau, session) : l'app affiche et réessaiera au prochain changement ou flushAll. */
  onError?: (category: VaultCategory, err: unknown) => void
}

export class VaultSync {
  private vault: LocalVault | null = null
  private readonly pending = new Map<VaultCategory, () => void>()
  private readonly dirty = new Set<VaultCategory>()
  private readonly schedule: Schedule
  private readonly debounceMs: number

  constructor(private readonly deps: VaultSyncDeps) {
    this.schedule = deps.schedule ?? ((fn, ms) => {
      const t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    })
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  attach(vault: LocalVault): void {
    this.vault = vault
  }

  /** Une modification dans cette catégorie : l'envoi part après le délai, repoussé à chaque nouvelle modification. */
  markDirty(category: VaultCategory): void {
    this.dirty.add(category)
    this.pending.get(category)?.()
    this.pending.set(
      category,
      this.schedule(() => {
        this.pending.delete(category)
        void this.flush(category)
      }, this.debounceMs),
    )
  }

  async flush(category: VaultCategory): Promise<void> {
    if (!this.vault) throw new Error('aucun coffre attaché')
    this.pending.get(category)?.()
    this.pending.delete(category)
    this.dirty.delete(category)
    try {
      const rows = await this.vault.exportCategory(category)
      const clear = new TextEncoder().encode(JSON.stringify(rows))
      const body = await buildSyncPayload(category, this.deps.keys()[SLOT[category]], clear, this.deps.signer().privateKey)
      wipe(clear)
      await this.deps.transport.sync(body)
    } catch (err) {
      this.dirty.add(category)
      if (this.deps.onError) this.deps.onError(category, err)
      else throw err
    }
  }

  /** Envoie tout ce qui attend, sans attendre le délai (fermeture de l'app, bouton). */
  async flushAll(): Promise<void> {
    for (const category of [...this.dirty]) await this.flush(category)
  }

  hasPending(): boolean {
    return this.dirty.size > 0
  }

  /** Restauration d'une catégorie depuis le backup (Techniques §5.5) : P2 → lignes → SQLite. */
  async restore(category: VaultCategory): Promise<{ restored: number }> {
    if (!this.vault) throw new Error('aucun coffre attaché')
    const backup = await this.deps.transport.restore(category)
    if (!backup) return { restored: 0 }
    const clear = await open(this.deps.keys()[SLOT[category]], new Uint8Array(Buffer.from(backup.payload, 'base64')))
    let rows: EncryptedRow[]
    try {
      rows = JSON.parse(Buffer.from(clear).toString('utf8')) as EncryptedRow[]
    } finally {
      wipe(clear)
    }
    await this.vault.importCategory(category, rows)
    return { restored: rows.length }
  }

  async restoreAll(): Promise<Record<VaultCategory, number>> {
    const out = {} as Record<VaultCategory, number>
    for (const c of VAULT_CATEGORIES) out[c] = (await this.restore(c)).restored
    return out
  }

  status(): Promise<SyncStatus> {
    if (!this.deps.transport.status) throw new Error('transport sans statut')
    return this.deps.transport.status()
  }
}
