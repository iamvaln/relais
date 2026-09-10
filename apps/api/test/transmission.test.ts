import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import sodium from '../src/lib/sodium.js'
import { objectStore } from '../src/services/storage/index.js'
import { api, closeAll, generateDeviceKeys, lastEmailTo, registerUser, resetState, signWith, stepUp, type DeviceKeys } from './helpers.js'
import { buildActivationBody, buildContactBody, buildShare, fetchRelaisKey, sealToRelais, sha256Hex, type ActivationContact } from './transmission-helpers.js'

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

// --- Modification (step-up edit_contacts / edit_transmission) --------------------

type Owner = Awaited<ReturnType<typeof owner>>

async function contactBody(o: Owner, seed = 1, roles: { k1?: boolean; k2?: boolean; k3?: boolean } = { k1: true }) {
  const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
  return buildContactBody(o.keys, o.relaisPk, {
    notification: { email: `contact${seed}@example.cm`, phone: '+237699000000' },
    roles,
    question_ids: [q1, q2, q3],
    secretSeed: seed,
  })
}

async function createContact(o: Owner, seed = 1): Promise<string> {
  const r = await (await api()).post('/transmission/contacts').set(o.auth).send(await contactBody(o, seed)).expect(201)
  return r.body.data.id as string
}

describe('PUT /transmission/contacts/:id', () => {
  it('exige un step-up edit_contacts', async () => {
    const o = await owner()
    const id = await createContact(o)
    const r = await (await api()).put(`/transmission/contacts/${id}`).set(o.auth).send(await contactBody(o, 2)).expect(403)
    expect(r.body.error.code).toBe('AUTH_STEPUP_REQUIRED')
  })

  it('remplace rôles, questions et notification en gardant la position', async () => {
    const o = await owner()
    const id = await createContact(o)
    const [, , , q4] = (await secretQuestionIds(4)) as [string, string, string, string]
    const body = await contactBody(o, 2, { k2: true, k3: true })
    body.question_ids = [body.question_ids[0], body.question_ids[1], q4]
    const su = await stepUp(o.accessToken, 'edit_contacts')
    const r = await (await api()).put(`/transmission/contacts/${id}`).set(o.auth).set('X-Step-Up-Token', su).send(body).expect(200)
    expect(r.body.data).toMatchObject({ id, position: 1, roles: { k1: false, k2: true, k3: true }, question_ids: body.question_ids })
    const row = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id } })
    expect(Buffer.from(row.notification_enc).toString('base64')).toBe(body.notification_enc)
    expect(Buffer.from(row.secret_enc).toString('base64')).toBe(body.secret_enc)
  })

  it('applique les mêmes règles que la création (question journal refusée)', async () => {
    const o = await owner()
    const id = await createContact(o)
    const journal = await prisma().checkin_questions.findFirstOrThrow({ where: { usage_type: 'journal' }, select: { id: true } })
    const body = await contactBody(o, 2)
    body.question_ids = [body.question_ids[0], body.question_ids[1], journal.id]
    const su = await stepUp(o.accessToken, 'edit_contacts')
    const r = await (await api()).put(`/transmission/contacts/${id}`).set(o.auth).set('X-Step-Up-Token', su).send(body).expect(400)
    expect(r.body.error.details.question_ids).toContain(journal.id)
  })

  it('répond 404 pour le contact d’un autre utilisateur', async () => {
    const a = await owner('a@example.cm')
    const b = await owner('b@example.cm')
    const id = await createContact(a)
    const su = await stepUp(b.accessToken, 'edit_contacts')
    await (await api()).put(`/transmission/contacts/${id}`).set(b.auth).set('X-Step-Up-Token', su).send(await contactBody(b, 2)).expect(404)
  })
})

describe('DELETE /transmission/contacts/:id', () => {
  it('retire le contact : il disparaît de la config mais la ligne reste (removed)', async () => {
    const o = await owner()
    const id = await createContact(o)
    const su = await stepUp(o.accessToken, 'edit_contacts')
    const r = await (await api()).delete(`/transmission/contacts/${id}`).set(o.auth).set('X-Step-Up-Token', su).expect(200)
    expect(r.body.data).toEqual({ id, status: 'removed' })
    const cfg = await (await api()).get('/transmission/config').set(o.auth).expect(200)
    expect(cfg.body.data.contacts).toEqual([])
    const row = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id } })
    expect(row.contact_status).toBe('removed')
  })

  it('un contact déjà retiré répond 404', async () => {
    const o = await owner()
    const id = await createContact(o)
    const su1 = await stepUp(o.accessToken, 'edit_contacts')
    await (await api()).delete(`/transmission/contacts/${id}`).set(o.auth).set('X-Step-Up-Token', su1).expect(200)
    const su2 = await stepUp(o.accessToken, 'edit_contacts')
    await (await api()).delete(`/transmission/contacts/${id}`).set(o.auth).set('X-Step-Up-Token', su2).expect(404)
  })

  it('le contact suivant prend la position libre suivante, jamais une position déjà attribuée', async () => {
    const o = await owner()
    const first = await createContact(o, 1)
    const su = await stepUp(o.accessToken, 'edit_contacts')
    await (await api()).delete(`/transmission/contacts/${first}`).set(o.auth).set('X-Step-Up-Token', su).expect(200)
    const r = await (await api()).post('/transmission/contacts').set(o.auth).send(await contactBody(o, 2)).expect(201)
    expect(r.body.data.position).toBe(2)
  })
})

describe('PUT /transmission/schema', () => {
  it('enregistre un schéma N-of-M valide (step-up edit_contacts)', async () => {
    const o = await owner()
    const su = await stepUp(o.accessToken, 'edit_contacts')
    const r = await (await api()).put('/transmission/schema').set(o.auth).set('X-Step-Up-Token', su).send({ n: 2, m: 3 }).expect(200)
    expect(r.body.data.schema).toEqual({ n: 2, m: 3 })
    const cfg = await (await api()).get('/transmission/config').set(o.auth).expect(200)
    expect(cfg.body.data.schema).toEqual({ n: 2, m: 3 })
  })

  it('refuse N < 2 et M < N', async () => {
    const o = await owner()
    for (const bad of [{ n: 1, m: 2 }, { n: 3, m: 2 }]) {
      const su = await stepUp(o.accessToken, 'edit_contacts')
      const r = await (await api()).put('/transmission/schema').set(o.auth).set('X-Step-Up-Token', su).send(bad).expect(400)
      expect(r.body.error.code).toBe('VALIDATION_ERROR')
    }
  })
})

describe('PUT /transmission/config', () => {
  it('enregistre silence et fréquence de check-in (step-up edit_transmission)', async () => {
    const o = await owner()
    const su = await stepUp(o.accessToken, 'edit_transmission')
    const r = await (await api())
      .put('/transmission/config')
      .set(o.auth)
      .set('X-Step-Up-Token', su)
      .send({ silence_duration_months: 6, checkin_frequency_weeks: 2 })
      .expect(200)
    expect(r.body.data).toMatchObject({ silence_duration_months: 6, checkin_frequency_weeks: 2, status: 'inactive' })
  })

  it('refuse une durée hors catalogue (DEC-22 : 1, 3 ou 6 mois ; 1, 2 ou 4 semaines)', async () => {
    const o = await owner()
    for (const bad of [{ silence_duration_months: 2, checkin_frequency_weeks: 4 }, { silence_duration_months: 3, checkin_frequency_weeks: 3 }]) {
      const su = await stepUp(o.accessToken, 'edit_transmission')
      const r = await (await api()).put('/transmission/config').set(o.auth).set('X-Step-Up-Token', su).send(bad).expect(400)
      expect(r.body.error.code).toBe('VALIDATION_ERROR')
    }
  })
})

// --- Activation (DEC-29 signatures des parts, DEC-30 email direct) -------------

type RolesIn = { k1?: boolean; k2?: boolean; k3?: boolean }

/** Crée les contacts via POST et renvoie de quoi les réémettre dans /activate. */
async function contacts(o: Owner, roles: RolesIn[]): Promise<ActivationContact[]> {
  const out: ActivationContact[] = []
  for (const [i, r] of roles.entries()) {
    const seed = i + 1
    const body = await contactBody(o, seed, r)
    const res = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(201)
    out.push({ id: res.body.data.id as string, body, seed })
  }
  return out
}

async function activate(o: Owner, body: unknown) {
  const su = await stepUp(o.accessToken, 'activate_transmission')
  return (await api()).post('/transmission/activate').set(o.auth).set('X-Step-Up-Token', su).send(body)
}

describe('POST /transmission/activate', () => {
  it('exige un step-up activate_transmission', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true }, { k1: true }])
    const r = await (await api()).post('/transmission/activate').set(o.auth).send(buildActivationBody(o.keys, cs)).expect(403)
    expect(r.body.error.code).toBe('AUTH_STEPUP_REQUIRED')
  })

  it('refuse avec moins de deux contacts', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true }])
    const r = await activate(o, buildActivationBody(o.keys, cs, { n: 2, m: 2 }))
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('TRANSMISSION_NOT_CONFIGURED')
  })

  it('refuse un schéma dont M dépasse le nombre de contacts', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true }, { k1: true }])
    const r = await activate(o, buildActivationBody(o.keys, cs, { n: 2, m: 3 }))
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('TRANSMISSION_NOT_CONFIGURED')
  })

  it('refuse sans aucun détenteur du rôle K1 (comptes & accès)', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k2: true }, { k3: true }])
    const r = await activate(o, buildActivationBody(o.keys, cs))
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('TRANSMISSION_NOT_CONFIGURED')
  })

  it('refuse une part manquante pour un rôle détenu', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true, k2: true }, { k1: true }])
    const body = buildActivationBody(o.keys, cs)
    body.contacts[0]!.shares.k2 = null
    const r = await activate(o, body)
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(r.body.error.details)).toContain(cs[0]!.id)
  })

  it('refuse une part pour un rôle non détenu', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true }, { k1: true }])
    const body = buildActivationBody(o.keys, cs)
    const extra = buildShare(o.keys, 99)
    body.contacts[1]!.shares.k3 = { enc: extra.enc, sig: extra.sig }
    const r = await activate(o, body)
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('refuse un contact vivant absent du corps', async () => {
    const o = await owner()
    await prisma().users.update({ where: { id: o.userId }, data: { plan: 'premium' } })
    const cs = await contacts(o, [{ k1: true }, { k1: true }, { k2: true }])
    const r = await activate(o, buildActivationBody(o.keys, cs.slice(0, 2)))
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.body.error.details)).toContain(cs[2]!.id)
  })

  it('DEC-29 : une seule signature de part invalide rejette toute l’activation, sans rien persister', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true }, { k1: true, k2: true }])
    const body = buildActivationBody(o.keys, cs)
    const impostor = buildShare(generateDeviceKeys(), 22)
    body.contacts[1]!.shares.k2 = { enc: body.contacts[1]!.shares.k2!.enc, sig: impostor.sig }
    const r = await activate(o, body)
    expect(r.status).toBe(401)
    expect(r.body.error.code).toBe('AUTH_TOKEN_INVALID')

    const cfg = await (await api()).get('/transmission/config').set(o.auth).expect(200)
    expect(cfg.body.data.status).toBe('inactive')
    expect(cfg.body.data.contacts.map((c: { shares: unknown }) => c.shares)).toEqual([
      { k1: false, k2: false, k3: false },
      { k1: false, k2: false, k3: false },
    ])
    expect(await objectStore().head(`shares/${o.userId}/${cs[0]!.id}/k1.enc`)).toBeNull()
    expect(await prisma().email_log.count({ where: { email_type: 'transmission_contact' } })).toBe(0)
  })

  it('active : parts stockées et hachées, verify_token, statut, check-in planifié, contacts prévenus (DEC-30)', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true, k2: true }, { k1: true, k3: true }])
    const body = buildActivationBody(o.keys, cs, { silence: 6, frequency: 2 })
    const before = Date.now()
    const r = await activate(o, body)
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual({ activated: true, contacts_notified: 2 })

    const cfg = await (await api()).get('/transmission/config').set(o.auth).expect(200)
    expect(cfg.body.data).toMatchObject({
      status: 'active',
      schema: { n: 2, m: 2 },
      silence_duration_months: 6,
      checkin_frequency_weeks: 2,
    })
    expect(Date.parse(cfg.body.data.activated_at)).toBeGreaterThanOrEqual(before - 1000)
    expect(cfg.body.data.contacts[0].shares).toEqual({ k1: true, k2: true, k3: false })
    expect(cfg.body.data.contacts[1].shares).toEqual({ k1: true, k2: false, k3: true })

    // Chaque part est sur le stockage objet, à un chemin choisi par le serveur, et hachée en base
    const row = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id: cs[0]!.id } })
    const k1 = Buffer.from(body.contacts[0]!.shares.k1!.enc, 'base64')
    expect(row.storj_k1_path).toBe(`shares/${o.userId}/${cs[0]!.id}/k1.enc`)
    expect(row.share_k1_hash).toBe(sha256Hex(k1))
    expect(Buffer.from((await objectStore().get(row.storj_k1_path!))!)).toEqual(k1)
    expect(row.storj_k3_path).toBeNull()
    expect(Buffer.from(row.verify_token!).toString('base64')).toBe(body.contacts[0]!.verify_token)

    // Le check-in démarre : prochaine échéance dans checkin_frequency_weeks
    const tc = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })
    const weeks = (tc.next_checkin_due!.getTime() - before) / (7 * 24 * 3600 * 1000)
    expect(weeks).toBeGreaterThan(1.99)
    expect(weeks).toBeLessThan(2.01)
    expect(tc.relance_count).toBe(0)

    // DEC-30 : email direct à chaque contact, tracé sans l'adresse en clair
    expect(lastEmailTo('contact1@example.cm')?.subject).toBeTruthy()
    expect(lastEmailTo('contact2@example.cm')?.subject).toBeTruthy()
    const logs = await prisma().email_log.findMany({ where: { email_type: 'transmission_contact' } })
    expect(logs.map((l) => l.recipient_hash).sort()).toEqual(
      [sha256Hex(Buffer.from('contact1@example.cm')), sha256Hex(Buffer.from('contact2@example.cm'))].sort(),
    )
    expect(logs.every((l) => l.user_id === o.userId && l.status === 'sent')).toBe(true)
  })

  it('refuse une seconde activation', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true }, { k1: true }])
    expect((await activate(o, buildActivationBody(o.keys, cs))).status).toBe(200)
    const r = await activate(o, buildActivationBody(o.keys, cs))
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('TRANSMISSION_ALREADY_ACTIVE')
  })

  it('une fois active, contacts et schéma sont figés (désactiver d’abord)', async () => {
    const o = await owner()
    const cs = await contacts(o, [{ k1: true }, { k1: true }])
    expect((await activate(o, buildActivationBody(o.keys, cs))).status).toBe(200)

    const add = await (await api()).post('/transmission/contacts').set(o.auth).send(await contactBody(o, 3)).expect(409)
    expect(add.body.error.code).toBe('TRANSMISSION_ALREADY_ACTIVE')
    const su1 = await stepUp(o.accessToken, 'edit_contacts')
    await (await api()).put(`/transmission/contacts/${cs[0]!.id}`).set(o.auth).set('X-Step-Up-Token', su1).send(await contactBody(o, 3)).expect(409)
    const su2 = await stepUp(o.accessToken, 'edit_contacts')
    await (await api()).delete(`/transmission/contacts/${cs[0]!.id}`).set(o.auth).set('X-Step-Up-Token', su2).expect(409)
    const su3 = await stepUp(o.accessToken, 'edit_contacts')
    await (await api()).put('/transmission/schema').set(o.auth).set('X-Step-Up-Token', su3).send({ n: 2, m: 2 }).expect(409)
  })
})
