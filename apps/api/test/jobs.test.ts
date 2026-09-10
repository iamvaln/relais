// Câblage BullMQ du balayage quotidien (Backend Specs §4.1, §4.2).

import { afterAll, describe, expect, it } from 'vitest'
import { DEADMAN_CRON, DEADMAN_JOB, startJobs, stopJobs } from '../src/jobs/queue.js'
import { closeAll } from './helpers.js'

afterAll(closeAll)

describe('startJobs', () => {
  it('planifie deadman:checkin tous les jours à 09:00 UTC, une seule fois, et s’arrête proprement', async () => {
    const queue = await startJobs()
    await startJobs() // idempotent
    const schedulers = await queue.getJobSchedulers()
    expect(schedulers).toHaveLength(1)
    expect(schedulers[0]).toMatchObject({ key: DEADMAN_JOB, pattern: DEADMAN_CRON })
    expect(DEADMAN_CRON).toBe('0 9 * * *')
    await stopJobs()
  })
})
