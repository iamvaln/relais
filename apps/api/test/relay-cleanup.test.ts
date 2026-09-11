// Nettoyage horaire des transmissions (Techniques §6.7 escrow TTL 72 h, E5-US03, E5-US04 accès 30 jours).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { trigger } from '../src/jobs/deadman.js'
import { cleanup } from '../src/jobs/relay-cleanup.js'
import { prisma } from '../src/lib/prisma.js'
import { redis } from '../src/lib/redis.js'
import { vaultKey } from '../src/api/vault/service.js'
import { objectStore } from '../src/services/storage/index.js'
import { api, closeAll, lastEmailTo, mailbox, resetState } from './helpers.js'
import { activateTransmission, makeOwner, plainShareBytes, type Owner } from './transmission-helpers.js'

const DAY = 24 * 3600 * 1000
const share = (seed: number) => plainShareBytes(seed).toString('base64')

beforeEach(resetState)
afterAll(closeAll)

function tokenFromEmail(to: string): string {
  const m = /\/relay\/([A-Za-z0-9_-]{32,})/.exec(lastEmailTo(to)?.text ?? '')
  if (!m) throw new Error(`pas de lien relay dans l'email à ${to}`)
  return m[1]!
}

async function opened(): Promise<{ o: Owner; t1: string; t2: string }> {
  const o = await makeOwner()
  await activateTransmission(o)
  await prisma().transmission_configs.update({ where: { user_id: o.userId }, data: { status: 'triggered' } })
  mailbox.clear()
  await trigger(new Date())
  return { o, t1: tokenFromEmail('contact1@example.cm'), t2: tokenFromEmail('contact2@example.cm') }
}

describe('cleanup — escrow expiré', () => {
  it('ne touche à rien avant l’échéance', async () => {
    const { t1 } = await opened()
    await (await api()).post(`/relay/${t1}/verify`).send({ shares: { k1: share(11) } }).expect(200)
    expect(await cleanup(new Date())).toEqual({ expired: 0, reopened: 0, purged: 0, stalled: 0 })
    expect(await prisma().escrow_shares.count()).toBe(1)
  })

  it('escrow expiré sans catégorie déverrouillée : transmission expirée, escrow vidé, le process repart avec de nouveaux liens (E5-US03)', async () => {
    const { o, t1 } = await opened()
    await (await api()).post(`/relay/${t1}/verify`).send({ shares: { k1: share(11) } }).expect(200)
    const tr = await prisma().transmissions.findFirstOrThrow()
    const later = new Date(tr.escrow_expires_at.getTime() + 3600 * 1000)
    mailbox.clear()

    expect(await cleanup(later)).toEqual({ expired: 1, reopened: 1, purged: 0, stalled: 0 })

    expect((await prisma().transmissions.findUniqueOrThrow({ where: { id: tr.id } })).status).toBe('expired')
    expect(await prisma().escrow_shares.count({ where: { transmission_id: tr.id } })).toBe(0)
    expect(await redis().exists(`escrow:key:${tr.id}`)).toBe(0)
    await (await api()).get(`/relay/${t1}`).expect(404)

    const fresh = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId, status: 'triggered' } })
    expect(fresh.id).not.toBe(tr.id)
    expect(fresh.triggered_at.toISOString()).toBe(later.toISOString())
    const newToken = tokenFromEmail('contact1@example.cm')
    expect(newToken).not.toBe(t1)
    await (await api()).get(`/relay/${newToken}`).expect(200)
  })
})

describe('cleanup — plafond de redémarrage (Proposal-9)', () => {
  it('après dms.relay_max_restarts (3) expirations, le process ne repart plus : la config reste triggered sans transmission ouverte', async () => {
    const { o } = await opened()
    let now = new Date()
    for (const round of [1, 2]) {
      const open = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId, status: 'triggered' } })
      now = new Date(open.escrow_expires_at.getTime() + 3600 * 1000)
      expect(await cleanup(now)).toEqual({ expired: 1, reopened: 1, purged: 0, stalled: 0 })
      expect(await prisma().transmissions.count({ where: { user_id: o.userId, status: 'expired' } })).toBe(round)
    }
    const third = await prisma().transmissions.findFirstOrThrow({ where: { user_id: o.userId, status: 'triggered' } })
    now = new Date(third.escrow_expires_at.getTime() + 3600 * 1000)
    mailbox.clear()
    expect(await cleanup(now)).toEqual({ expired: 1, reopened: 0, purged: 0, stalled: 1 })
    expect(await prisma().transmissions.count({ where: { user_id: o.userId, status: 'expired' } })).toBe(3)
    expect(await prisma().transmissions.count({ where: { user_id: o.userId, status: { in: ['triggered', 'in_progress'] } } })).toBe(0)
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).status).toBe('triggered')
    expect(lastEmailTo('contact1@example.cm')).toBeUndefined()
    // le job suivant ne relance rien non plus
    expect(await cleanup(new Date(now.getTime() + DAY))).toEqual({ expired: 0, reopened: 0, purged: 0, stalled: 0 })
  })
})

describe('cleanup — fin d’accès (E5-US04, 30 jours)', () => {
  it('catégorie déverrouillée depuis plus de 30 jours après l’escrow : purge et statut completed', async () => {
    const { o, t1, t2 } = await opened()
    await objectStore().put(vaultKey(o.userId, 'accounts'), new Uint8Array([1, 2, 3]))
    await (await api()).post(`/relay/${t1}/verify`).send({ shares: { k1: share(11) } }).expect(200)
    await (await api()).post(`/relay/${t2}/verify`).send({ shares: { k1: share(21) } }).expect(200)
    const tr = await prisma().transmissions.findFirstOrThrow()

    // à l'expiration de l'escrow, l'accès déverrouillé reste ouvert
    const afterEscrow = new Date(tr.escrow_expires_at.getTime() + DAY)
    expect(await cleanup(afterEscrow)).toEqual({ expired: 0, reopened: 0, purged: 0, stalled: 0 })
    await (await api()).get(`/relay/${t1}/data`).expect(200)

    const afterAccess = new Date(tr.escrow_expires_at.getTime() + 31 * DAY)
    expect(await cleanup(afterAccess)).toEqual({ expired: 0, reopened: 0, purged: 1, stalled: 0 })
    expect((await prisma().transmissions.findUniqueOrThrow({ where: { id: tr.id } })).status).toBe('completed')
    expect(await objectStore().head(vaultKey(o.userId, 'accounts'))).toBeNull()
    expect(await prisma().escrow_shares.count()).toBe(0)
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).status).toBe('completed')
  })
})
