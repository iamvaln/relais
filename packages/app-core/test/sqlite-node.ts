// Adaptateur VaultDatabase sur node:sqlite — une vraie base SQLite pour les
// tests, pas un simulacre. L'app mobile a le sien sur expo-sqlite.

import { DatabaseSync } from 'node:sqlite'
import type { VaultDatabase } from '../src/vault/database.js'

export class NodeSqlite implements VaultDatabase {
  private readonly db: DatabaseSync
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path)
  }
  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }
  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]))
  }
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }
  /** Lecture brute pour vérifier ce qui est réellement sur le disque. */
  raw<T>(sql: string): T[] {
    return this.db.prepare(sql).all() as T[]
  }
}
