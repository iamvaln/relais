// Le fichier SQLite du coffre, chiffré par SQLCipher (décision du 11/09/2026) :
// PRAGMA key = clé dérivée du seed (KeyStore.dbKey), posé avant toute lecture.
// Derrière, l'interface VaultDatabase d'app-core.

import * as SQLite from 'expo-sqlite'
import type { VaultDatabase } from '@relais/app-core'

const DB_NAME = 'relais.db'

export class ExpoVaultDatabase implements VaultDatabase {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}
  exec(sql: string): Promise<void> {
    return this.db.execAsync(sql)
  }
  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.db.runAsync(sql, params as SQLite.SQLiteBindParams)
  }
  all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams)
  }
  close(): Promise<void> {
    return this.db.closeAsync()
  }
}

export async function openVaultDatabase(dbKey: Uint8Array): Promise<ExpoVaultDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME)
  const hex = Buffer.from(dbKey).toString('hex')
  // SQLCipher : la clé brute en hex, première instruction sur la connexion.
  await db.execAsync(`PRAGMA key = "x'${hex}'"`)
  return new ExpoVaultDatabase(db)
}

export function deleteVaultDatabase(): Promise<void> {
  return SQLite.deleteDatabaseAsync(DB_NAME)
}
