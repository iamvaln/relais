// Balayage quotidien du dead man's switch (Backend Specs §4.2, E4-US02).
// La fonction est appelée directement avec une horloge injectée — pas de file
// d'attente ici ; le câblage BullMQ est testé à part.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sweep } from '../src/jobs/deadman.js'
import { prisma } from '../src/lib/prisma.js'
import { closeAll, lastEmailTo, mailbox, resetState } from './helpers.js'
import { activateTransmission, makeOwner } from './transmission-helpers.js'

const DAY = 24 * 3600 * 1000
const NOW = new Date('2026-09-10T09:00:00Z')

beforeEach(resetState)
afterAll(closeAll)

async function overdueBy(userId: string, days: number, extra: { relance_count?: number; last_relance_at?: Date; status?: string } = {}) {
  await prisma().transmission_configs.update({
    where: { user_id: userId },
    data: { next_checkin_due: new Date(NOW.getTime() - days * DAY), ...extra },
  })
}

async function config(userId: string) {
  return prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: userId } })
}

describe('sweep — relances J+7 / J+14 / J+21', () => {
  it('ne fait rien pour une échéance à venir ni pour un retard de moins de 7 jours', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    mailbox.clear()
    expect(await sweep(NOW)).toEqual({ relances: 0, triggered: 0 })
    await overdueBy(o.userId, 6)
    expect(await sweep(NOW)).toEqual({ relances: 0, triggered: 0 })
    expect(mailbox.sent).toHaveLength(0)
  })

  it('J+7 : relance 1 par email, tracée dans checkin_relances et email_log, une seule fois', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    mailbox.clear()
    await overdueBy(o.userId, 7)
    expect(await sweep(NOW)).toEqual({ relances: 1, triggered: 0 })

    const mail = lastEmailTo(o.email)
    expect(mail?.subject).toBe('Un petit signe ?')
    const cfg = await config(o.userId)
    expect(cfg.relance_count).toBe(1)
    expect(cfg.last_relance_at?.toISOString()).toBe(NOW.toISOString())
    const relances = await prisma().checkin_relances.findMany({ where: { user_id: o.userId }, include: { email_log: true } })
    expect(relances).toHaveLength(1)
    expect(relances[0]).toMatchObject({ relance_number: 1 })
    expect(relances[0]!.email_log?.email_type).toBe('checkin_relance_1')

    // Le lendemain, rien de plus : la relance 2 attend J+14.
    expect(await sweep(new Date(NOW.getTime() + DAY))).toEqual({ relances: 0, triggered: 0 })
    expect(await prisma().checkin_relances.count()).toBe(1)
  })

  it('J+14 puis J+21 : relances 2 et 3, avec les templates correspondants', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    mailbox.clear()
    await overdueBy(o.userId, 14, { relance_count: 1, last_relance_at: new Date(NOW.getTime() - 7 * DAY) })
    expect(await sweep(NOW)).toEqual({ relances: 1, triggered: 0 })
    expect(lastEmailTo(o.email)?.subject).toContain('pas eu de nouvelles')

    await overdueBy(o.userId, 21, { relance_count: 2 })
    expect(await sweep(NOW)).toEqual({ relances: 1, triggered: 0 })
    expect(lastEmailTo(o.email)?.subject).toContain('dernier rappel')
    expect((await config(o.userId)).relance_count).toBe(3)
    expect((await prisma().checkin_relances.findMany({ orderBy: { relance_number: 'asc' } })).map((r) => r.relance_number)).toEqual([2, 3])
  })

  it('lit les intervalles dans app_config (dms.relance_intervals_days)', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await prisma().app_config.update({ where: { key: 'dms.relance_intervals_days' }, data: { value: '[2,4,6]' } })
    try {
      await overdueBy(o.userId, 2)
      expect(await sweep(NOW)).toEqual({ relances: 1, triggered: 0 })
    } finally {
      await prisma().app_config.update({ where: { key: 'dms.relance_intervals_days' }, data: { value: '[7,14,21]' } })
    }
  })

  it('ignore les transmissions en pause et inactives', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await overdueBy(o.userId, 30, { status: 'paused' })
    expect(await sweep(NOW)).toEqual({ relances: 0, triggered: 0 })
  })
})

describe('sweep — déclenchement après le silence configuré', () => {
  it('trois relances envoyées mais silence non écoulé : pas de déclenchement', async () => {
    const o = await makeOwner()
    await activateTransmission(o, { silence: 3 })
    await overdueBy(o.userId, 60, { relance_count: 3, last_relance_at: new Date(NOW.getTime() - 39 * DAY) })
    expect(await sweep(NOW)).toEqual({ relances: 0, triggered: 0 })
    expect((await config(o.userId)).status).toBe('active')
  })

  it('silence écoulé (1 mois) et trois relances : statut triggered', async () => {
    const o = await makeOwner()
    await activateTransmission(o, { silence: 1 })
    await overdueBy(o.userId, 31, { relance_count: 3, last_relance_at: new Date(NOW.getTime() - 10 * DAY) })
    expect(await sweep(NOW)).toEqual({ relances: 0, triggered: 1 })
    expect((await config(o.userId)).status).toBe('triggered')
    // idempotent : une transmission déclenchée n'est plus balayée
    expect(await sweep(NOW)).toEqual({ relances: 0, triggered: 0 })
  })

  it('silence écoulé mais relances incomplètes : on envoie la relance manquante, on ne déclenche pas encore', async () => {
    const o = await makeOwner()
    await activateTransmission(o, { silence: 1 })
    await overdueBy(o.userId, 31, { relance_count: 2, last_relance_at: new Date(NOW.getTime() - 17 * DAY) })
    expect(await sweep(NOW)).toEqual({ relances: 1, triggered: 0 })
    expect((await config(o.userId)).status).toBe('active')
  })
})
