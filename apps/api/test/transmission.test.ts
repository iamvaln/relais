import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import sodium from '../src/lib/sodium.js'
import { api, closeAll, generateDeviceKeys, registerUser, resetState, signWith, type DeviceKeys } from './helpers.js'
import { buildContactBody, fetchRelaisKey, sealToRelais } from './transmission-helpers.js'

/** Owner avec clé publique enregistrée + clé de Relais récupérée. */
async function owner(email = 'adjoua@example.cm') {
  const u = await registerUser(email)
  const keys: DeviceKeys = generateDeviceKeys()
  const auth = { Authorization: `Bearer ${u.accessToken}` }
  await (await api()).post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)
  const relaisPk = await fetchRelaisKey()
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

describe('GET /transmission/relais-key (DEC-28)', () => {
  it('est public, expose relais_x25519_pk (32 bytes) + key_version, et se met en cache un jour', async () => {
    const r = await (await api()).get('/transmission/relais-key').expect(200)
    const pk = Buffer.from(r.body.data.relais_x25519_pk, 'base64')
    expect(pk).toHaveLength(32)
    expect(r.body.data.key_version).toMatch(/^[0-9a-f]{8,}$/)
    expect(r.headers['cache-control']).toBe('public, max-age=86400')
    // Dérivée de RELAIS_X25519_SK : stable d'un appel à l'autre
    const again = await (await api()).get('/transmission/relais-key').expect(200)
    expect(again.body.data).toEqual(r.body.data)
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

  describe('Note-01 : validation des trois questions', () => {
    async function post(o: Awaited<ReturnType<typeof owner>>, question_ids: [string, string, string]) {
      const body = await buildContactBody(o.keys, o.relaisPk, {
        notification: { email: 'herve@example.cm', phone: '+237699000000' },
        roles: { k1: true },
        question_ids,
      })
      const r = await (await api()).post('/transmission/contacts').set(o.auth).send(body)
      expect(r.status).toBe(400)
      return r
    }

    it('refuse une question de type journal', async () => {
      const o = await owner()
      const [q1, q2] = (await secretQuestionIds(2)) as [string, string]
      const journal = await prisma().checkin_questions.findFirstOrThrow({ where: { usage_type: 'journal' }, select: { id: true } })
      const r = await post(o, [q1, q2, journal.id])
      expect(r.body.error.code).toBe('VALIDATION_ERROR')
      expect(r.body.error.details.question_ids).toContain(journal.id)
      expect(await prisma().trusted_contacts.count()).toBe(0)
    })

    it('refuse une question sous vault.question_min_score', async () => {
      const o = await owner()
      const [q1, q2] = (await secretQuestionIds(2)) as [string, string]
      const weak = await prisma().checkin_questions.create({
        data: { text_fr: '[test] faible', text_en: '[test] weak', category: 'childhood', usage_type: 'secret_question', reliability_score: 5 },
        select: { id: true },
      })
      const r = await post(o, [q1, q2, weak.id])
      expect(r.body.error.details.question_ids).toContain(weak.id)
    })

    it('refuse deux fois la même question', async () => {
      const o = await owner()
      const [q1, q2] = (await secretQuestionIds(2)) as [string, string]
      const r = await post(o, [q1, q2, q1])
      expect(r.body.error.details.question_ids).toContain(q1)
    })

    it('refuse une question inconnue', async () => {
      const o = await owner()
      const [q1, q2] = (await secretQuestionIds(2)) as [string, string]
      const ghost = '00000000-0000-4000-8000-000000000000'
      const r = await post(o, [q1, q2, ghost])
      expect(r.body.error.details.question_ids).toContain(ghost)
    })
  })

  it('refuse un contact sans aucun rôle', async () => {
    const o = await owner()
    const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
    const body = await buildContactBody(o.keys, o.relaisPk, {
      notification: { email: 'herve@example.cm', phone: '+237699000000' },
      roles: {},
      question_ids: [q1, q2, q3],
    })
    const r = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(400)
    expect(r.body.error.code).toBe('VALIDATION_ERROR')
    expect(r.body.error.details.roles).toBeDefined()
  })

  async function validBody(o: Awaited<ReturnType<typeof owner>>, seed = 1) {
    const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
    return buildContactBody(o.keys, o.relaisPk, {
      notification: { email: `contact${seed}@example.cm`, phone: '+237699000000' },
      roles: { k1: true },
      question_ids: [q1, q2, q3],
      secretSeed: seed,
    })
  }

  describe('limites de plan (BO-05 vault.free_max_contacts / premium_max_contacts)', () => {
    it('plan gratuit : refuse le troisième contact', async () => {
      const o = await owner()
      for (let i = 1; i <= 2; i++) await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o, i)).expect(201)
      const r = await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o, 3)).expect(403)
      expect(r.body.error.code).toBe('PLAN_LIMIT_REACHED')
      expect(await prisma().trusted_contacts.count()).toBe(2)
    })

    it('plan premium : accepte cinq contacts, refuse le sixième', async () => {
      const o = await owner()
      await prisma().users.update({ where: { id: o.userId }, data: { plan: 'premium' } })
      for (let i = 1; i <= 5; i++) await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o, i)).expect(201)
      const r = await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o, 6)).expect(403)
      expect(r.body.error.code).toBe('PLAN_LIMIT_REACHED')
    })

    it('un contact retiré ne compte plus dans la limite', async () => {
      const o = await owner()
      const first = await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o, 1)).expect(201)
      await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o, 2)).expect(201)
      await prisma().trusted_contacts.update({ where: { id: first.body.data.id }, data: { contact_status: 'removed' } })
      await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o, 3)).expect(201)
    })
  })

  describe('preuves cryptographiques (DEC-28, DEC-29)', () => {
    it('refuse une notification_sig produite par une autre clé', async () => {
      const o = await owner()
      const impostor = generateDeviceKeys()
      const body = await validBody(o)
      body.notification_sig = signWith(impostor, Buffer.from(body.notification_enc, 'base64'))
      const r = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(401)
      expect(r.body.error.code).toBe('AUTH_TOKEN_INVALID')
      expect(await prisma().trusted_contacts.count()).toBe(0)
    })

    it('refuse une sealed box qui ne s’ouvre pas avec la clé de Relais', async () => {
      const o = await owner()
      const body = await validBody(o)
      const otherPk = Buffer.from(sodium.crypto_box_keypair().publicKey).toString('base64')
      body.notification_enc = await sealToRelais(otherPk, { email: 'x@example.cm', phone: '+237600000000' })
      body.notification_sig = signWith(o.keys, Buffer.from(body.notification_enc, 'base64'))
      const r = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(400)
      expect(r.body.error.code).toBe('VALIDATION_ERROR')
      expect(r.body.error.details.notification_enc).toBeDefined()
    })

    it('refuse un owner qui n’a pas encore enregistré sa clé publique', async () => {
      const u = await registerUser('sans-cle@example.cm')
      const keys = generateDeviceKeys()
      const o = { ...u, keys, auth: { Authorization: `Bearer ${u.accessToken}` }, relaisPk: await fetchRelaisKey() }
      const r = await (await api()).post('/transmission/contacts').set(o.auth).send(await validBody(o)).expect(409)
      expect(r.body.error.code).toBe('AUTH_KEY_NOT_SET')
    })
  })
})
