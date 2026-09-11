// Ce que le coffre attend d'une base SQLite. L'app mobile fournit expo-sqlite
// (fichier sous SQLCipher, clé dérivée du seed) ; les tests, node:sqlite.

export interface VaultDatabase {
  exec(sql: string): Promise<void>
  run(sql: string, params?: unknown[]): Promise<void>
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
}
