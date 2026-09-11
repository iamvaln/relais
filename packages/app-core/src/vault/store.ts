// Coffre local (E2-US01 à US04, Techniques §1, §5.2, §5.4).
//
//   payload = P1 = seal(Ki, JSON { service_name, login, password, instructions, notes })
//   catégorie, urgence, dates : colonnes en clair — le fichier SQLite est
//   lui-même chiffré par SQLCipher sur le device (décision du 11/09/2026).
//
// Les clés viennent du KeyStore (fonction, pas valeur : elles peuvent être
// effacées entre deux appels). La lecture déchiffre en mémoire ; rien ne
// passe par le réseau. `onChange(category)` alimente la synchronisation.

import { type CategoryKeys, type KeySlot, open, seal } from '@relais/crypto-core'
import type { VaultDatabase } from './database.js'
import { type EncryptedRow, type VaultCategory, type VaultFilter, type VaultItem, type VaultItemInput, VAULT_CATEGORIES } from './types.js'

const SLOT: Record<VaultCategory, KeySlot> = { accounts: 'k1', messages: 'k2', finances: 'k3' }

interface Row {
  id: string
  category: VaultCategory
  urgency: VaultItem['urgency']
  payload: Uint8Array
  created_at: number
  updated_at: number
}

type Secret = Pick<VaultItem, 'service_name' | 'login' | 'password' | 'instructions' | 'notes'>

const utf8 = new TextEncoder()
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export interface LocalVaultDeps {
  now?: () => number
  id?: () => string
  onChange?: (category: VaultCategory) => void
}

export class LocalVault {
  private readonly now: () => number
  private readonly newId: () => string
  private readonly onChange: (category: VaultCategory) => void

  constructor(
    private readonly db: VaultDatabase,
    private readonly keys: () => CategoryKeys,
    deps: LocalVaultDeps = {},
  ) {
    this.now = deps.now ?? Date.now
    this.newId = deps.id ?? (() => globalThis.crypto.randomUUID())
    this.onChange = deps.onChange ?? (() => undefined)
  }

  async init(): Promise<void> {
    await this.db.exec(`CREATE TABLE IF NOT EXISTS vault_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      urgency TEXT NOT NULL,
      payload BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    await this.db.exec('CREATE INDEX IF NOT EXISTS idx_vault_items_category ON vault_items(category)')
  }

  private key(category: VaultCategory): Uint8Array {
    return this.keys()[SLOT[category]]
  }

  private async encrypt(category: VaultCategory, secret: Secret): Promise<Uint8Array> {
    const clear = utf8.encode(JSON.stringify(secret))
    try {
      return await seal(this.key(category), clear)
    } finally {
      clear.fill(0)
    }
  }

  private async decrypt(row: Row): Promise<VaultItem> {
    const clear = await open(this.key(row.category), new Uint8Array(row.payload))
    const secret = JSON.parse(Buffer.from(clear).toString('utf8')) as Secret
    clear.fill(0)
    return { id: row.id, category: row.category, urgency: row.urgency, created_at: row.created_at, updated_at: row.updated_at, ...secret }
  }

  private static secretOf(item: VaultItemInput): Secret {
    const s: Secret = { service_name: item.service_name }
    if (item.login !== undefined) s.login = item.login
    if (item.password !== undefined) s.password = item.password
    if (item.instructions !== undefined) s.instructions = item.instructions
    if (item.notes !== undefined) s.notes = item.notes
    return s
  }

  async add(input: VaultItemInput): Promise<VaultItem> {
    if (!input.service_name.trim()) throw new Error('le nom du service est obligatoire')
    const now = this.now()
    const id = this.newId()
    const payload = await this.encrypt(input.category, LocalVault.secretOf(input))
    await this.db.run('INSERT INTO vault_items (id, category, urgency, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, input.category, input.urgency, payload, now, now])
    this.onChange(input.category)
    return { id, created_at: now, updated_at: now, ...input }
  }

  async get(id: string): Promise<VaultItem | null> {
    const rows = await this.db.all<Row>('SELECT * FROM vault_items WHERE id = ?', [id])
    return rows[0] ? this.decrypt(rows[0]) : null
  }

  async update(id: string, patch: Partial<Omit<VaultItemInput, 'category'>>): Promise<VaultItem> {
    const current = await this.get(id)
    if (!current) throw new Error('fiche introuvable')
    const next: VaultItem = { ...current, ...patch, updated_at: this.now() }
    if (!next.service_name.trim()) throw new Error('le nom du service est obligatoire')
    const payload = await this.encrypt(next.category, LocalVault.secretOf(next))
    await this.db.run('UPDATE vault_items SET urgency = ?, payload = ?, updated_at = ? WHERE id = ?', [next.urgency, payload, next.updated_at, id])
    this.onChange(next.category)
    return next
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db.all<{ category: VaultCategory }>('SELECT category FROM vault_items WHERE id = ?', [id])
    if (!rows[0]) return
    await this.db.run('DELETE FROM vault_items WHERE id = ?', [id])
    this.onChange(rows[0].category)
  }

  /** Lecture en mémoire : le filtre par nom se fait après déchiffrement. */
  async list(filter: VaultFilter = {}): Promise<VaultItem[]> {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.category) {
      where.push('category = ?')
      params.push(filter.category)
    }
    if (filter.urgency) {
      where.push('urgency = ?')
      params.push(filter.urgency)
    }
    const rows = await this.db.all<Row>(`SELECT * FROM vault_items${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC, id ASC`, params)
    const items = await Promise.all(rows.map((r) => this.decrypt(r)))
    if (!filter.search?.trim()) return items
    const needles = normalize(filter.search).split(/\s+/).filter(Boolean)
    return items.filter((i) => {
      const hay = normalize(i.service_name)
      return needles.every((n) => hay.includes(n))
    })
  }

  async counts(): Promise<Record<VaultCategory, number>> {
    const rows = await this.db.all<{ category: VaultCategory; n: number }>('SELECT category, COUNT(*) AS n FROM vault_items GROUP BY category')
    const out = Object.fromEntries(VAULT_CATEGORIES.map((c) => [c, 0])) as Record<VaultCategory, number>
    for (const r of rows) out[r.category] = Number(r.n)
    return out
  }

  /** Les lignes d'une catégorie telles quelles (payload opaque, en base64) — ce qui part en backup. */
  async exportCategory(category: VaultCategory): Promise<EncryptedRow[]> {
    const rows = await this.db.all<Row>('SELECT * FROM vault_items WHERE category = ? ORDER BY created_at ASC, id ASC', [category])
    return rows.map((r) => ({ id: r.id, category: r.category, urgency: r.urgency, payload: b64(r.payload), created_at: r.created_at, updated_at: r.updated_at }))
  }

  /** Restauration : remplace la catégorie par les lignes du backup. Ne déclenche pas de sync. */
  async importCategory(category: VaultCategory, rows: EncryptedRow[]): Promise<void> {
    await this.db.exec('BEGIN')
    try {
      await this.db.run('DELETE FROM vault_items WHERE category = ?', [category])
      for (const r of rows) {
        if (r.category !== category) throw new Error(`ligne ${r.id} : catégorie ${r.category} inattendue`)
        await this.db.run('INSERT INTO vault_items (id, category, urgency, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [r.id, r.category, r.urgency, fromB64(r.payload), r.created_at, r.updated_at])
      }
      await this.db.exec('COMMIT')
    } catch (err) {
      await this.db.exec('ROLLBACK')
      throw err
    }
  }
}
