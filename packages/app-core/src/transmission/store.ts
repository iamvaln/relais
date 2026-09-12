// Contacts de confiance sur le device (E3-US01 à US03, E2-US05).
//
//   payload = seal(K2, JSON { name, email, phone, message, answers })
//   rôles, questions, position, identifiant serveur : colonnes en clair — le
//   serveur les connaît déjà, et le fichier est sous SQLCipher.
//
// Décision du 12/09/2026 : les réponses secrètes restent ici, chiffrées,
// jamais synchronisées. Sur un nouveau device elles sont à ressaisir.

import { type CategoryKeys, open, seal } from '@relais/crypto-core'
import type { VaultDatabase } from '../vault/database.js'
import { type Answers, type Contact, type ContactInput, type QuestionIds, type Roles, ROLE_SLOTS } from './types.js'

interface Row {
  id: string
  server_id: string | null
  position: number
  roles: string
  question_ids: string
  payload: Uint8Array
  created_at: number
  updated_at: number
}

type Secret = Pick<ContactInput, 'name' | 'email' | 'phone' | 'message' | 'answers'>

const utf8 = new TextEncoder()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ContactStoreDeps {
  now?: () => number
  id?: () => string
}

export function rolesToText(roles: Roles): string {
  return ROLE_SLOTS.filter((s) => roles[s]).join(',')
}

export function rolesFromText(text: string): Roles {
  const set = new Set(text.split(',').filter(Boolean))
  return { k1: set.has('k1'), k2: set.has('k2'), k3: set.has('k3') }
}

export class ContactStore {
  private readonly now: () => number
  private readonly newId: () => string

  constructor(
    private readonly db: VaultDatabase,
    private readonly keys: () => CategoryKeys,
    deps: ContactStoreDeps = {},
  ) {
    this.now = deps.now ?? Date.now
    this.newId = deps.id ?? (() => globalThis.crypto.randomUUID())
  }

  async init(): Promise<void> {
    await this.db.exec(`CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      server_id TEXT,
      position INTEGER NOT NULL,
      roles TEXT NOT NULL,
      question_ids TEXT NOT NULL,
      payload BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
  }

  private static clean(input: ContactInput): ContactInput {
    const name = input.name.trim()
    const email = input.email.trim().toLowerCase()
    const phone = input.phone?.trim() || null
    if (!name) throw new Error('le nom du contact est obligatoire')
    if (!EMAIL.test(email)) throw new Error("l'email du contact est invalide")
    return { name, email, phone, message: input.message, roles: { ...input.roles }, questionIds: [...input.questionIds] as QuestionIds, answers: input.answers ? ([...input.answers] as Answers) : null }
  }

  private async encrypt(secret: Secret): Promise<Uint8Array> {
    const clear = utf8.encode(JSON.stringify(secret))
    try {
      return await seal(this.keys().k2, clear)
    } finally {
      clear.fill(0)
    }
  }

  private async decrypt(row: Row): Promise<Contact> {
    const clear = await open(this.keys().k2, new Uint8Array(row.payload))
    const secret = JSON.parse(Buffer.from(clear).toString('utf8')) as Secret
    clear.fill(0)
    return {
      id: row.id,
      serverId: row.server_id,
      position: row.position,
      roles: rolesFromText(row.roles),
      questionIds: row.question_ids.split(',') as QuestionIds,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...secret,
    }
  }

  private async insert(c: Contact): Promise<void> {
    const payload = await this.encrypt({ name: c.name, email: c.email, phone: c.phone, message: c.message, answers: c.answers })
    await this.db.run('INSERT INTO contacts (id, server_id, position, roles, question_ids, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      c.id,
      c.serverId,
      c.position,
      rolesToText(c.roles),
      c.questionIds.join(','),
      payload,
      c.created_at,
      c.updated_at,
    ])
  }

  private async nextPosition(): Promise<number> {
    const rows = await this.db.all<{ max: number | null }>('SELECT MAX(position) AS max FROM contacts')
    return (rows[0]?.max ?? 0) + 1
  }

  async add(input: ContactInput & { serverId?: string | null }): Promise<Contact> {
    const now = this.now()
    const c: Contact = { id: this.newId(), serverId: input.serverId ?? null, position: await this.nextPosition(), created_at: now, updated_at: now, ...ContactStore.clean(input) }
    await this.insert(c)
    return c
  }

  async get(id: string): Promise<Contact | null> {
    const rows = await this.db.all<Row>('SELECT * FROM contacts WHERE id = ?', [id])
    return rows[0] ? this.decrypt(rows[0]) : null
  }

  async byServerId(serverId: string): Promise<Contact | null> {
    const rows = await this.db.all<Row>('SELECT * FROM contacts WHERE server_id = ?', [serverId])
    return rows[0] ? this.decrypt(rows[0]) : null
  }

  async update(id: string, patch: Partial<ContactInput & { serverId: string | null }>): Promise<Contact> {
    const current = await this.get(id)
    if (!current) throw new Error('contact introuvable')
    const merged = { ...current, ...patch }
    const next: Contact = { ...merged, ...ContactStore.clean(merged), updated_at: this.now() }
    const payload = await this.encrypt({ name: next.name, email: next.email, phone: next.phone, message: next.message, answers: next.answers })
    await this.db.run('UPDATE contacts SET server_id = ?, roles = ?, question_ids = ?, payload = ?, updated_at = ? WHERE id = ?', [
      next.serverId,
      rolesToText(next.roles),
      next.questionIds.join(','),
      payload,
      next.updated_at,
      id,
    ])
    return next
  }

  async remove(id: string): Promise<void> {
    await this.db.run('DELETE FROM contacts WHERE id = ?', [id])
  }

  async list(): Promise<Contact[]> {
    const rows = await this.db.all<Row>('SELECT * FROM contacts ORDER BY position ASC, id ASC')
    return Promise.all(rows.map((r) => this.decrypt(r)))
  }

  /** Restauration depuis GET /transmission/config : remplace tout, positions imposées. */
  async replaceAll(contacts: (ContactInput & { serverId: string | null; position: number })[]): Promise<void> {
    await this.db.exec('BEGIN')
    try {
      await this.db.run('DELETE FROM contacts')
      const now = this.now()
      for (const c of contacts) {
        await this.insert({ id: this.newId(), serverId: c.serverId, position: c.position, created_at: now, updated_at: now, ...ContactStore.clean(c) })
      }
      await this.db.exec('COMMIT')
    } catch (err) {
      await this.db.exec('ROLLBACK')
      throw err
    }
  }
}
