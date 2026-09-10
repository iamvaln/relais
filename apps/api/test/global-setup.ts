// Une fois par run : base de test recréée depuis les migrations + seed,
// Redis vidé. Les services doivent tourner (scripts/dev-services.sh start).

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../../..')

export const TEST_PG_PORT = process.env.TEST_PG_PORT ?? '55432'
export const TEST_REDIS_PORT = process.env.TEST_REDIS_PORT ?? '55379'
export const TEST_DB = 'relais_test'

function psql(db: string, args: string[]): void {
  execFileSync('psql', ['-h', 'localhost', '-p', TEST_PG_PORT, '-U', 'relais', '-d', db, '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}

export default function setup(): void {
  psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${TEST_DB};`, '-c', `CREATE DATABASE ${TEST_DB};`])

  const migrationsDir = join(ROOT, 'prisma', 'migrations')
  for (const dir of readdirSync(migrationsDir).sort()) {
    psql(TEST_DB, ['-f', join(migrationsDir, dir, 'migration.sql')])
  }
  psql(TEST_DB, ['-f', join(ROOT, 'prisma', 'seeds', '001_checkin_questions.sql')])

  execFileSync('redis-cli', ['-p', TEST_REDIS_PORT, 'flushall'], { stdio: 'ignore' })
}
