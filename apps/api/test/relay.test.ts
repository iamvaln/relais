// Transmission côté contact (Backend Specs §3.7, Techniques §6.7–6.8, E5).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { trigger } from '../src/jobs/deadman.js'
import { hmacToken } from '../src/lib/crypto.js'
import { prisma } from '../src/lib/prisma.js'
import { closeAll, lastEmailTo, mailbox, resetState } from './helpers.js'
import { activateTransmission, makeOwner, type Owner } from './transmission-helpers.js'

const HOUR = 3600 * 1000
const NOW = new Date('2026-09-10T09:00:00Z')

beforeEach(resetState)
afterAll(closeAll)

/** Le token de relay tel qu'il figure dans l'email reçu par un contact. */
function tokenFromEmail(to: string): string {
  const mail = lastEmailTo(to)
  const m = /\/relay\/([A-Za-z0-9_-]{32,})/.exec(mail?.text ?? '')
  if (!m) throw new Error(`pas de lien relay dans l'email à ${to}`)
  return m[1]!
}

async function markTriggered(o: Owner): Promise<void> {
  await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { status: 'triggered' } })
}

describe('deadman trigger — ouverture de la transmission', () => {
  it('ne fait rien sans config déclenchée', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    expect(await trigger(NOW)).toEqual({ transmissions: 0, contacts_notified: 0 })
  })

  it('crée la transmission, un token par contact, et prévient chaque contact par email — une seule fois', async () => {
    const o = await makeOwner()
    const cs = await activateTransmission(o)
    await markTriggered(o)
    mailbox.clear()

    expect(await trigger(NOW)).toEqual({ transmissions: 1, contacts_notified: 2 })

    const tr = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId }, include: { transmission_contacts: true } })
    expect(tr).toMatchObject({ status: 'triggered', schema_n_snapshot: 2, schema_m_snapshot: 2, k1_completed: false })
    expect(tr.triggered_at.toISOString()).toBe(NOW.toISOString())
    expect(tr.escrow_expires_at.getTime() - NOW.getTime()).toBe(72 * HOUR)
    expect(tr.transmission_contacts).toHaveLength(2)
    expect(tr.transmission_contacts.map((c) => c.trusted_contact_id).sort()).toEqual(cs.map((c) => c.id).sort())

    for (const email of ['contact1@example.cm', 'contact2@example.cm']) {
      const token = tokenFromEmail(email)
      const row = tr.transmission_contacts.find((c) => c.relay_token_hash === hmacToken(token))
      expect(row).toBeDefined()
      expect(row).toMatchObject({ status: 'notified', relay_token_used: false, fail_count: 0, blocked: false })
      expect(row!.relay_token_expires_at.getTime() - NOW.getTime()).toBe(72 * HOUR)
      expect(lastEmailTo(email)?.text).not.toContain(o.userId)
    }
    const logs = await prisma().email_log.findMany({ where: { user_id: o.userId, email_type: 'transmission_contact' } })
    expect(logs).toHaveLength(4) // 2 à l'activation (DEC-30) + 2 au déclenchement

    // Idempotent : la config reste 'triggered', mais la transmission existe déjà.
    expect(await trigger(NOW)).toEqual({ transmissions: 0, contacts_notified: 0 })
    expect(await prisma().transmissions.count()).toBe(1)
  })

  it('lit dms.escrow_ttl_hours dans app_config', async () => {
    const o = await makeOwner()
    await activateTransmission(o)
    await markTriggered(o)
    await prisma().app_config.update({ where: { key: 'dms.escrow_ttl_hours' }, data: { value: '48' } })
    try {
      await trigger(NOW)
      const tr = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId } })
      expect(tr.escrow_expires_at.getTime() - NOW.getTime()).toBe(48 * HOUR)
    } finally {
      await prisma().app_config.update({ where: { key: 'dms.escrow_ttl_hours' }, data: { value: '72' } })
    }
  })
})
