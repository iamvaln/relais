// File d'attente BullMQ (Backend Specs §4) — trois jobs planifiés :
// deadman:checkin (09:00 UTC, §4.2), relay:cleanup (horaire), billing:expire (09:45 UTC). Le worker vit
// dans le processus API ; plusieurs instances peuvent tourner, Redis garantit
// qu'un tick n'est traité qu'une fois.

import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { runDeadman } from './deadman.js'
import { cleanup } from './relay-cleanup.js'
import { expireSubscriptions } from './billing.js'

export const QUEUE_NAME = 'deadman'
export const DEADMAN_JOB = 'deadman:checkin'
export const DEADMAN_CRON = '0 9 * * *'
export const CLEANUP_JOB = 'relay:cleanup'
export const CLEANUP_CRON = '30 * * * *'
export const BILLING_JOB = 'billing:expire'
export const BILLING_CRON = '45 9 * * *'

let connection: Redis | undefined
let queue: Queue | undefined
let worker: Worker | undefined

function bullConnection(): Redis {
  // BullMQ exige maxRetriesPerRequest: null — connexion dédiée, distincte de lib/redis.
  connection ??= new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false })
  return connection
}

export async function startJobs(): Promise<Queue> {
  if (queue) return queue
  const conn = bullConnection()
  queue = new Queue(QUEUE_NAME, { connection: conn })
  await queue.upsertJobScheduler(DEADMAN_JOB, { pattern: DEADMAN_CRON }, { name: DEADMAN_JOB })
  await queue.upsertJobScheduler(CLEANUP_JOB, { pattern: CLEANUP_CRON }, { name: CLEANUP_JOB })
  await queue.upsertJobScheduler(BILLING_JOB, { pattern: BILLING_CRON }, { name: BILLING_JOB })
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === DEADMAN_JOB) return runDeadman()
      if (job.name === CLEANUP_JOB) return cleanup()
      if (job.name === BILLING_JOB) return expireSubscriptions()
      return null
    },
    { connection: conn, concurrency: 1 },
  )
  return queue
}

export async function stopJobs(): Promise<void> {
  await worker?.close()
  await queue?.close()
  worker = undefined
  queue = undefined
  connection?.disconnect()
  connection = undefined
}
