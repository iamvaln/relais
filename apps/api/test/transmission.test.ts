import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { api, closeAll, generateDeviceKeys, registerUser, resetState, type DeviceKeys } from './helpers.js'
import { buildContactBody, fetchRelaisKey } from './transmission-helpers.js'

/** Owner avec clé publique enregistrée + clé de Relais récupérée. */
async function owner(email = 'adjoua@example.cm') {
  const u = await registerUser(email)
  const keys: DeviceKeys = generateDeviceKeys()
  const auth = { Authorization: `Bearer ${u.accessToken}` }
  await (await api()).post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)
  const relaisPk = await fetchRelaisKey(u.accessToken)
  return { ...u, keys, auth, relaisPk }
}

/** N questions secrètes valides (score ≥ 6, actives) prises dans le seed. */
async function secretQuestionIds(n: number): Promise<string[]> {
  const rows = await prisma().checkin_questions.findMany({
    where: { usage_type: 'secret_question', status: 'active', reliability_score: { gte: 6 } },
    orderBy: { text_fr: 'asc' },
    take: n,
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

beforeEach(resetState)
afterAll(closeAll)

describe('GET /transmission/config', () => {
  it('rend l’état vide d’un utilisateur qui n’a rien configuré', async () => {
    const { accessToken } = await registerUser('adjoua@example.cm')
    const r = await (await api()).get('/transmission/config').set('Authorization', `Bearer ${accessToken}`).expect(200)
    expect(r.body.data).toEqual({
      status: 'inactive',
      schema: { n: 2, m: 2 },
      silence_duration_months: 3,
      checkin_frequency_weeks: 4,
      pause_until: null,
      activated_at: null,
      contacts: [],
    })
  })
})

describe('GET /transmission/relais-key', () => {
  it('expose la clé publique X25519 de Relais (32 bytes) pour sceller notification_enc', async () => {
    const { accessToken } = await registerUser('adjoua@example.cm')
    const r = await (await api()).get('/transmission/relais-key').set('Authorization', `Bearer ${accessToken}`).expect(200)
    const pk = Buffer.from(r.body.data.x25519_pk, 'base64')
    expect(pk).toHaveLength(32)
    // Dérivée de RELAIS_PRIVATE_KEY : stable d'un appel à l'autre
    const again = await (await api()).get('/transmission/relais-key').set('Authorization', `Bearer ${accessToken}`).expect(200)
    expect(again.body.data.x25519_pk).toBe(r.body.data.x25519_pk)
  })
})

describe('POST /transmission/contacts', () => {
  it('crée un contact en position 1 avec ses rôles et ses trois questions', async () => {
    const o = await owner()
    const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
    const body = await buildContactBody(o.keys, o.relaisPk, {
      notification: { email: 'herve@example.cm', phone: '+237699000000' },
      roles: { k1: true, k2: true },
      question_ids: [q1, q2, q3],
    })
    const r = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(201)
    expect(r.body.data).toMatchObject({
      position: 1,
      roles: { k1: true, k2: true, k3: false },
      question_ids: [q1, q2, q3],
      status: 'active',
      shares: { k1: false, k2: false, k3: false },
    })
    expect(r.body.data.id).toBeTypeOf('string')

    const cfg = await (await api()).get('/transmission/config').set(o.auth).expect(200)
    expect(cfg.body.data.contacts).toHaveLength(1)
    expect(cfg.body.data.contacts[0].id).toBe(r.body.data.id)
    // Rien de lisible côté serveur : notification_enc et secret_enc restent des blobs
    const row = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id: r.body.data.id } })
    expect(Buffer.from(row.notification_enc).toString('utf8')).not.toContain('herve@')
    expect(row.notification_hash).toHaveLength(64)
  })
})
