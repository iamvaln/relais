// Câblage BullMQ du balayage quotidien (Backend Specs §4.1, §4.2).

import { afterAll, describe, expect, it } from 'vitest'
import { CLEANUP_CRON, CLEANUP_JOB, DEADMAN_CRON, DEADMAN_JOB, startJobs, stopJobs } from '../src/jobs/queue.js'
import { closeAll } from './helpers.js'

afterAll(closeAll)

describe('startJobs', () => {
  it('planifie deadman:checkin (09:00 UTC) et relay:cleanup (toutes les heures), une seule fois, et s’arrête proprement', async () => {
    const queue = await startJobs()
    await startJobs() // idempotent
    const schedulers = (await queue.getJobSchedulers()).sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''))
    expect(schedulers).toHaveLength(2)
    expect(schedulers).toMatchObject([
      { key: DEADMAN_JOB, pattern: DEADMAN_CRON },
      { key: CLEANUP_JOB, pattern: CLEANUP_CRON },
    ])
    expect(DEADMAN_CRON).toBe('0 9 * * *')
    expect(CLEANUP_CRON).toBe('30 * * * *')
    await stopJobs()
  })
})
