// Câblage BullMQ du balayage quotidien (Backend Specs §4.1, §4.2).

import { afterAll, describe, expect, it } from 'vitest'
import { BILLING_CRON, BILLING_JOB, CHAIN_DRAIN_CRON, CHAIN_DRAIN_JOB, CHAIN_RECONCILE_CRON, CHAIN_RECONCILE_JOB, CLEANUP_CRON, CLEANUP_JOB, DEADMAN_CRON, DEADMAN_JOB, MAINTENANCE_CRON, MAINTENANCE_JOB, startJobs, stopJobs } from '../src/jobs/queue.js'
import { env, loadEnv, setEnvForTests } from '../src/config/env.js'
import { closeAll } from './helpers.js'

afterAll(closeAll)

describe('startJobs', () => {
  it('planifie deadman:checkin (09:00), relay:cleanup (horaire) et billing:expire (09:45), une seule fois, et s’arrête proprement', async () => {
    const queue = await startJobs()
    await startJobs() // idempotent
    const schedulers = (await queue.getJobSchedulers()).sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''))
    expect(schedulers).toHaveLength(4)
    expect(schedulers).toMatchObject([
      { key: BILLING_JOB, pattern: BILLING_CRON },
      { key: DEADMAN_JOB, pattern: DEADMAN_CRON },
      { key: MAINTENANCE_JOB, pattern: MAINTENANCE_CRON },
      { key: CLEANUP_JOB, pattern: CLEANUP_CRON },
    ])
    expect(BILLING_CRON).toBe('45 9 * * *')
    expect(DEADMAN_CRON).toBe('0 9 * * *')
    expect(CLEANUP_CRON).toBe('30 * * * *')
    await stopJobs()
  })

  it('chaîne activée (lot 2a) : chain:drain chaque minute et chain:reconcile à 10:00 en plus ; désactivée, ils disparaissent', async () => {
    setEnvForTests({ ...env(), CHAIN_ENABLED: 'true', CHAIN_RPC_URL: 'http://127.0.0.1:1', CHAIN_CONTRACT_ADDRESS: `0x${'1'.repeat(40)}`, CHAIN_OPERATOR_KEY_ENC: 'enc1:AAAA', CHAIN_KEY_ENC_KEY: 'k'.repeat(40) })
    try {
      const queue = await startJobs()
      const keys = (await queue.getJobSchedulers()).map((s) => s.key).sort()
      expect(keys).toContain(CHAIN_DRAIN_JOB)
      expect(keys).toContain(CHAIN_RECONCILE_JOB)
      expect(keys).toHaveLength(6)
      expect(CHAIN_DRAIN_CRON).toBe('* * * * *')
      expect(CHAIN_RECONCILE_CRON).toBe('0 10 * * *')
      await stopJobs()
    } finally {
      setEnvForTests(loadEnv())
    }
    const queue = await startJobs()
    expect((await queue.getJobSchedulers()).map((s) => s.key).sort()).not.toContain(CHAIN_DRAIN_JOB)
    expect(await queue.getJobSchedulers()).toHaveLength(4)
    await stopJobs()
  })
})
