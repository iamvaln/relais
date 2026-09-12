// Transmission côté contact (Backend Specs §3.7, Techniques §6.7–6.8, E5).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { trigger } from '../src/jobs/deadman.js'
import { hmacToken } from '../src/lib/crypto.js'
import { prisma } from '../src/lib/prisma.js'
import { redis } from '../src/lib/redis.js'
import { vaultKey } from '../src/api/vault/service.js'
import { objectStore } from '../src/services/storage/index.js'
import { api, closeAll, lastEmailTo, mailbox, resetState } from './helpers.js'
import { activateTransmission, makeOwner, opaque, plainShareBytes, type ActivationContact, type Owner } from './transmission-helpers.js'

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
    expect(logs).toHaveLength(2) // les 2 de l'activation sont des contact_designated (Point-1)
    expect(await prisma().email_log.count({ where: { user_id: o.userId, email_type: 'contact_designated' } })).toBe(2)

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

// --- Côté contact : lecture du lien ---------------------------------------------------

interface Opened {
  o: Owner
  contacts: ActivationContact[]
  tokens: Record<string, string>
}

/** Transmission activée, déclenchée, ouverte : un token par contact (contact1@, contact2@). */
async function opened(): Promise<Opened> {
  const o = await makeOwner()
  const contacts = await activateTransmission(o)
  await markTriggered(o)
  mailbox.clear()
  await trigger(new Date())
  return {
    o,
    contacts,
    tokens: { contact1: tokenFromEmail('contact1@example.cm'), contact2: tokenFromEmail('contact2@example.cm') },
  }
}

describe('audit HIGH-3 : après une annulation par l’admin, un nouveau silence rouvre une transmission', () => {
  it('une transmission cancelled ne bloque plus l’ouverture ; la nouvelle a ses propres tokens ; toujours idempotent', async () => {
    const { o, tokens } = await opened()
    // L'admin annule (BO-02), puis le silence se prolonge de nouveau
    await prisma().transmissions.updateMany({ data: { status: 'cancelled', cancelled_at: new Date() } })
    await markTriggered(o)
    mailbox.clear()
    expect(await trigger(new Date())).toEqual({ transmissions: 1, contacts_notified: 2 })
    expect(await prisma().transmissions.count()).toBe(2)
    expect(await prisma().transmissions.count({ where: { status: 'triggered' } })).toBe(1)
    const fresh = tokenFromEmail('contact1@example.cm')
    expect(fresh).not.toBe(tokens.contact1)
    await (await api()).get(`/relay/${fresh}`).expect(200)
    await (await api()).get(`/relay/${tokens.contact1}`).expect(404)
    expect(await trigger(new Date())).toEqual({ transmissions: 0, contacts_notified: 0 })
  })
})

describe('audit MEDIUM-10 : une sealed box illisible n’empêche pas de prévenir les autres contacts', () => {
  it('le contact dont la notification ne s’ouvre plus est ignoré, l’autre reçoit son lien, le job ne lève pas', async () => {
    const o = await makeOwner()
    const contacts = await activateTransmission(o)
    await prisma().trusted_contacts.update({ where: { id: contacts[0]!.id }, data: { notification_enc: opaque(777, 120) } })
    await markTriggered(o)
    mailbox.clear()
    expect(await trigger(new Date())).toEqual({ transmissions: 1, contacts_notified: 1 })
    expect(lastEmailTo('contact1@example.cm')).toBeUndefined()
    expect(lastEmailTo('contact2@example.cm')).toBeDefined()
    expect(await prisma().transmission_contacts.count()).toBe(2)
  })
})

describe('GET /relay/:token', () => {
  it('lien inconnu → 404 RELAY_TOKEN_INVALID', async () => {
    const r = await (await api()).get(`/relay/${'a'.repeat(43)}`).expect(404)
    expect(r.body.error.code).toBe('RELAY_TOKEN_INVALID')
  })

  it('rend au contact ce dont l’app a besoin : questions, rôles, verify_token, parts chiffrées, statut', async () => {
    const { o, contacts, tokens } = await opened()
    const r = await (await api()).get(`/relay/${tokens.contact1}`).expect(200)
    const d = r.body.data
    expect(d).toMatchObject({
      owner_name: 'Adjoua Ngo',
      status: 'triggered',
      contact_status: 'notified',
      schema: { n: 2, m: 2 },
      answered: 0,
      roles: { k1: true, k2: false, k3: false },
      shares_enc: { k2: null, k3: null },
    })
    expect(d.questions).toHaveLength(3)
    expect(d.questions.map((q: { id: string }) => q.id)).toEqual(contacts[0]!.body.question_ids)
    expect(d.questions[0].text_fr).toBeTypeOf('string')
    expect(d.questions[0].text_en).toBeTypeOf('string')
    expect(d.verify_token).toBe(opaque(100, 40).toString('base64'))
    expect(d.shares_enc.k1).toBe(opaque(11, 32).toString('base64'))
    expect(d.secret_enc).toBe(contacts[0]!.body.secret_enc)
    expect(Date.parse(d.escrow_expires_at)).toBeGreaterThan(Date.now())
    expect(JSON.stringify(d)).not.toContain(o.userId)
    expect(JSON.stringify(d)).not.toContain('example.cm')
  })

  it('lien expiré → 404', async () => {
    const { tokens } = await opened()
    await prisma().transmission_contacts.updateMany({ data: { relay_token_expires_at: new Date(Date.now() - 1000) } })
    const r = await (await api()).get(`/relay/${tokens.contact1}`).expect(404)
    expect(r.body.error.code).toBe('RELAY_TOKEN_INVALID')
  })

  it('contact bloqué → 423 RELAY_CONTACT_BLOCKED', async () => {
    const { tokens, contacts } = await opened()
    await prisma().transmission_contacts.updateMany({ where: { trusted_contact_id: contacts[0]!.id }, data: { blocked: true } })
    await prisma().trusted_contacts.update({ where: { id: contacts[0]!.id }, data: { blocked_until: new Date(Date.now() + 3600 * 1000) } })
    const r = await (await api()).get(`/relay/${tokens.contact1}`).expect(423)
    expect(r.body.error.code).toBe('RELAY_CONTACT_BLOCKED')
    await (await api()).get(`/relay/${tokens.contact2}`).expect(200)
  })
})

// --- Réponses aux questions : escrow et tentatives ------------------------------------

const share = (seed: number) => plainShareBytes(seed).toString('base64')

async function verify(token: string, body: unknown) {
  return (await api()).post(`/relay/${token}/verify`).send(body)
}

describe('POST /relay/:token/verify — tentatives (E5-US02)', () => {
  it('cinq échecs déclarés : quatre acceptés, le cinquième bloque 24 h, le lien répond 423', async () => {
    const { tokens, contacts } = await opened()
    for (let left = 4; left >= 1; left--) {
      const r = await verify(tokens.contact1, { failed: true })
      expect(r.status).toBe(200)
      expect(r.body.data).toEqual({ accepted: false, attempts_left: left })
    }
    const fifth = await verify(tokens.contact1, { failed: true })
    expect(fifth.status).toBe(429)
    expect(fifth.body.error.code).toBe('RELAY_TOKEN_EXHAUSTED')

    const row = await prisma().transmission_contacts.findFirstOrThrow({ where: { trusted_contact_id: contacts[0]!.id } })
    expect(row).toMatchObject({ fail_count: 5, blocked: true, status: 'failed' })
    const tc = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id: contacts[0]!.id } })
    expect(tc.blocked_until!.getTime() - Date.now()).toBeGreaterThan(23.9 * HOUR)
    expect((await (await api()).get(`/relay/${tokens.contact1}`)).status).toBe(423)
    expect((await verify(tokens.contact1, { failed: true })).status).toBe(423)

    // Proposal-9 : l'autre contact est prévenu du blocage, pas le bloqué
    expect(lastEmailTo('contact2@example.cm')?.subject).toMatch(/du nouveau/)
    expect(lastEmailTo('contact2@example.cm')?.text).toMatch(/bloqué 24 heures/)
    expect(lastEmailTo('contact1@example.cm')?.subject).not.toMatch(/du nouveau/)
    expect(await prisma().email_log.count({ where: { email_type: 'contact_progress' } })).toBe(1)
  })

  it('le blocage se lève seul après blocked_until, compteur remis à zéro', async () => {
    const { tokens, contacts } = await opened()
    for (let i = 0; i < 5; i++) await verify(tokens.contact1, { failed: true })
    await prisma().trusted_contacts.update({ where: { id: contacts[0]!.id }, data: { blocked_until: new Date(Date.now() - 1000) } })
    const r = await (await api()).get(`/relay/${tokens.contact1}`).expect(200)
    expect(r.body.data.contact_status).toBe('notified')
    const row = await prisma().transmission_contacts.findFirstOrThrow({ where: { trusted_contact_id: contacts[0]!.id } })
    expect(row).toMatchObject({ fail_count: 0, blocked: false })
  })

  it('audit LOW-15 : POST /relay/:token/verify est limité à 10 requêtes par minute et par IP, avant même le compteur de tentatives', async () => {
    const { tokens } = await opened()
    for (let i = 0; i < 10; i++) {
      const r = await verify(tokens.contact1, { failed: true })
      expect(r.body.error?.code, `itération ${i}`).not.toBe('RATE_LIMITED') // 200 puis RELAY_TOKEN_EXHAUSTED : le handler répond encore
    }
    const r = await verify(tokens.contact1, { failed: true })
    expect(r.status).toBe(429)
    expect(r.body.error.code).toBe('RATE_LIMITED')
  })

  it('un envoi malformé compte comme une tentative : part manquante, part d’un rôle non détenu, mauvaise taille', async () => {
    const { tokens, contacts } = await opened()
    for (const bad of [{ shares: {} }, { shares: { k1: share(1), k2: share(2) } }, { shares: { k1: opaque(1, 16).toString('base64') } }, { shares: { k1: share(1) }, failed: true }]) {
      const r = await verify(tokens.contact1, bad)
      expect(r.status).toBe(400)
      expect(r.body.error.code).toBe('VALIDATION_ERROR')
    }
    const row = await prisma().transmission_contacts.findFirstOrThrow({ where: { trusted_contact_id: contacts[0]!.id } })
    expect(row.fail_count).toBe(4)
  })
})

describe('POST /relay/:token/verify — parts en escrow (Techniques §6.7)', () => {
  it('une part acceptée : escrow chiffré par une clé éphémère Redis, contact answered, transmission in_progress', async () => {
    const { tokens, contacts } = await opened()
    const r = await verify(tokens.contact1, { shares: { k1: share(11) } })
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual({ accepted: true, answered: 1, needed: 2, unlocked: { k1: false, k2: false, k3: false } })

    const tr = await prisma().transmissions.findFirstOrThrow({ include: { escrow_shares: true, transmission_contacts: true } })
    expect(tr.status).toBe('in_progress')
    expect(tr.k1_completed).toBe(false)
    expect(tr.escrow_shares).toHaveLength(1)
    const es = tr.escrow_shares[0]!
    expect(es).toMatchObject({ key_category: 'k1', redis_key_id: `escrow:key:${tr.id}` })
    expect(Buffer.from(es.share_tmp_enc).toString('base64')).not.toBe(share(11))
    expect(Buffer.from(es.share_tmp_enc).includes(plainShareBytes(11))).toBe(false)
    expect(es.expires_at.toISOString()).toBe(tr.escrow_expires_at.toISOString())
    const ttl = await redis().ttl(es.redis_key_id)
    expect(ttl).toBeGreaterThan(71 * 3600)
    const me = tr.transmission_contacts.find((c) => c.trusted_contact_id === contacts[0]!.id)!
    expect(me).toMatchObject({ status: 'answered', relay_token_used: true })
    expect(me.answered_at).not.toBeNull()

    const again = await verify(tokens.contact1, { shares: { k1: share(11) } })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('RELAY_ALREADY_ANSWERED')
  })

  it('Proposal-8 : une part dont le SHA256 ne correspond pas au hash signé à l’activation est refusée et compte comme un échec', async () => {
    const { tokens, contacts } = await opened()
    const r = await verify(tokens.contact1, { shares: { k1: opaque(999, 33).toString('base64') } })
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('RELAY_SHARE_INVALID')
    expect(r.body.error.details).toEqual({ attempts_left: 4, slot: 'k1' })
    const tc = await prisma().transmission_contacts.findFirstOrThrow({ where: { trusted_contact_id: contacts[0]!.id } })
    expect(tc).toMatchObject({ status: 'notified', fail_count: 1 })
    expect(await prisma().escrow_shares.count()).toBe(0)
    // la vraie part passe ensuite
    expect((await verify(tokens.contact1, { shares: { k1: share(11) } })).status).toBe(200)
  })

  it('N parts pour une catégorie : elle est déverrouillée pour tous', async () => {
    const { tokens } = await opened()
    await verify(tokens.contact1, { shares: { k1: share(11) } })
    const r = await verify(tokens.contact2, { shares: { k1: share(21) } })
    expect(r.body.data).toEqual({ accepted: true, answered: 2, needed: 2, unlocked: { k1: true, k2: false, k3: false } })
    const tr = await prisma().transmissions.findFirstOrThrow()
    expect(tr.k1_completed).toBe(true)
    // l'accès dure 30 jours après l'escrow : la clé éphémère survit à l'escrow (E5-US04)
    expect(await redis().ttl(`escrow:key:${tr.id}`)).toBeGreaterThan(30 * 24 * 3600)
    const link = await (await api()).get(`/relay/${tokens.contact1}`).expect(200)
    expect(link.body.data).toMatchObject({ status: 'in_progress', answered: 2, contact_status: 'answered' })
  })
})

// --- Statut, données, confirmation (E5-US03 à E5-US05) ----------------------------------

const P2_ACCOUNTS = Buffer.from('P2-accounts-blob-chiffre-cote-client')

async function bothAnswered(): Promise<Opened> {
  const op = await opened()
  await objectStore().put(vaultKey(op.o.userId, 'accounts'), new Uint8Array(P2_ACCOUNTS))
  expect((await verify(op.tokens.contact1, { shares: { k1: share(11) } })).status).toBe(200)
  expect((await verify(op.tokens.contact2, { shares: { k1: share(21) } })).status).toBe(200)
  return op
}

describe('GET /relay/:token/status', () => {
  it('progression : répondu / requis / total, catégories déverrouillées', async () => {
    const { tokens } = await opened()
    const r = await (await api()).get(`/relay/${tokens.contact1}/status`).expect(200)
    expect(r.body.data).toMatchObject({
      status: 'triggered',
      contact_status: 'notified',
      answered: 0,
      needed: 2,
      total: 2,
      unlocked: { k1: false, k2: false, k3: false },
    })
    await verify(tokens.contact2, { shares: { k1: share(21) } })
    const again = await (await api()).get(`/relay/${tokens.contact1}/status`).expect(200)
    expect(again.body.data).toMatchObject({ status: 'in_progress', contact_status: 'notified', answered: 1 })
  })
})

describe('GET /relay/:token/data', () => {
  it('tant que N parts manquent, ou si le contact n’a pas répondu : 409 RELAY_NOT_UNLOCKED', async () => {
    const { tokens } = await opened()
    const before = await (await api()).get(`/relay/${tokens.contact1}/data`).expect(409)
    expect(before.body.error.code).toBe('RELAY_NOT_UNLOCKED')
    await verify(tokens.contact1, { shares: { k1: share(11) } })
    await (await api()).get(`/relay/${tokens.contact1}/data`).expect(409)
  })

  it('une fois déverrouillé : les N parts de l’escrow, P2 de la catégorie, secret_enc — pour chaque rôle détenu', async () => {
    const { tokens, contacts } = await bothAnswered()
    const r = await (await api()).get(`/relay/${tokens.contact1}/data`).expect(200)
    expect(r.body.data.secret_enc).toBe(contacts[0]!.body.secret_enc)
    expect(Object.keys(r.body.data.categories)).toEqual(['k1'])
    const k1 = r.body.data.categories.k1
    expect(k1.category).toBe('accounts')
    expect([...k1.shares].sort()).toEqual([share(11), share(21)].sort())
    expect(Buffer.from(k1.p2, 'base64')).toEqual(P2_ACCOUNTS)
  })

  it('E2-US07 : le porteur de K2 déverrouillé reçoit aussi le carnet (mois, mode, blob) ; un porteur K1 seul, non', async () => {
    const { o, tokens, contacts } = await bothAnswered()
    await prisma().journal_entries.createMany({
      data: [
        { user_id: o.userId, entry_month: new Date('2026-03-01T00:00:00Z'), mode: 'essential', content_enc: opaque(301, 80) },
        { user_id: o.userId, entry_month: new Date('2026-05-01T00:00:00Z'), mode: 'free', content_enc: opaque(305, 80) },
      ],
    })
    // Le contact 1 est aussi Gardien du souvenir et K2 est reconstituée
    await prisma().trusted_contacts.update({ where: { id: contacts[0]!.id }, data: { has_k2_role: true } })
    await prisma().transmissions.updateMany({ data: { k2_completed: true } })

    const r = await (await api()).get(`/relay/${tokens.contact1}/data`).expect(200)
    expect(Object.keys(r.body.data.categories).sort()).toEqual(['k1', 'k2'])
    expect(r.body.data.journal).toEqual([
      { month: '2026-03-01', mode: 'essential', content_enc: opaque(301, 80).toString('base64') },
      { month: '2026-05-01', mode: 'free', content_enc: opaque(305, 80).toString('base64') },
    ])
    const other = await (await api()).get(`/relay/${tokens.contact2}/data`).expect(200)
    expect(other.body.data.journal).toBeUndefined()
  })

  it('escrow expiré (clé Redis disparue) : 409, rien de lisible', async () => {
    const { tokens } = await bothAnswered()
    const tr = await prisma().transmissions.findFirstOrThrow()
    await redis().del(`escrow:key:${tr.id}`)
    const r = await (await api()).get(`/relay/${tokens.contact1}/data`).expect(409)
    expect(r.body.error.message).toMatch(/escrow/i)
  })
})

describe('POST /relay/:token/confirm (E5-US05)', () => {
  it('audit HIGH-1 : un contact qui a répondu sans qu’aucune de ses catégories soit déverrouillée ne peut pas confirmer, rien n’est purgé', async () => {
    const { o, tokens } = await opened()
    await objectStore().put(vaultKey(o.userId, 'accounts'), new Uint8Array(P2_ACCOUNTS))
    expect((await verify(tokens.contact1, { shares: { k1: share(11) } })).status).toBe(200)
    const r = await (await api()).post(`/relay/${tokens.contact1}/confirm`).expect(409)
    expect(r.body.error.code).toBe('RELAY_NOT_UNLOCKED')
    expect(await prisma().escrow_shares.count()).toBe(1)
    expect(await objectStore().head(vaultKey(o.userId, 'accounts'))).not.toBeNull()
    const tr = await prisma().transmissions.findFirstOrThrow()
    expect(tr.status).toBe('in_progress')
    expect(await prisma().transmission_contacts.count({ where: { status: 'confirmed' } })).toBe(0)
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).status).toBe('triggered')
  })

  it('un contact qui n’a pas répondu ne peut pas confirmer', async () => {
    const { tokens } = await opened()
    const r = await (await api()).post(`/relay/${tokens.contact1}/confirm`).expect(409)
    expect(r.body.error.code).toBe('RELAY_NOT_UNLOCKED')
  })

  it('la transmission se termine quand chaque contact ayant répondu a confirmé : purge totale, log conservé', async () => {
    const { o, tokens, contacts } = await bothAnswered()
    const tr = await prisma().transmissions.findFirstOrThrow()
    await prisma().journal_entries.create({ data: { user_id: o.userId, entry_month: new Date('2026-03-01T00:00:00Z'), mode: 'essential', content_enc: opaque(301, 80) } })
    await prisma().annual_wrappeds.create({ data: { user_id: o.userId, year: 2026, stats_enc: opaque(400, 60), entry_count: 6 } })
    const first = await (await api()).post(`/relay/${tokens.contact1}/confirm`).expect(200)
    expect(first.body.data).toEqual({ confirmed: true, transmission_status: 'in_progress' })
    expect(await prisma().escrow_shares.count()).toBe(2)
    // Proposal-9 : l'autre contact apprend la confirmation
    expect(lastEmailTo('contact2@example.cm')?.subject).toMatch(/du nouveau/)
    expect(lastEmailTo('contact2@example.cm')?.text).toMatch(/terminé sa part/)

    const second = await (await api()).post(`/relay/${tokens.contact2}/confirm`).expect(200)
    expect(second.body.data).toEqual({ confirmed: true, transmission_status: 'completed' })

    const done = await prisma().transmissions.findUniqueOrThrow({ where: { id: tr.id }, include: { transmission_contacts: true } })
    expect(done.status).toBe('completed')
    expect(done.completed_at).not.toBeNull()
    expect(done.transmission_contacts.every((c) => c.status === 'confirmed' && c.confirmed_at !== null)).toBe(true)
    expect(await prisma().escrow_shares.count()).toBe(0)
    expect(await redis().exists(`escrow:key:${tr.id}`)).toBe(0)
    expect(await objectStore().head(vaultKey(o.userId, 'accounts'))).toBeNull()
    expect(await objectStore().head(`shares/${o.userId}/${contacts[0]!.id}/k1.enc`)).toBeNull()
    const tc = await prisma().trusted_contacts.findUniqueOrThrow({ where: { id: contacts[0]!.id } })
    expect(tc.storj_k1_path).toBeNull()
    expect((await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: o.userId } })).status).toBe('completed')
    // E5-US05 : le carnet et les rétrospectives partent avec le reste
    expect(await prisma().journal_entries.count({ where: { user_id: o.userId } })).toBe(0)
    expect(await prisma().annual_wrappeds.count({ where: { user_id: o.userId } })).toBe(0)
    // le lien est clos
    await (await api()).get(`/relay/${tokens.contact1}`).expect(404)
    // la confirmation qui termine la transmission ne prévient plus personne
    expect(await prisma().email_log.count({ where: { email_type: 'contact_progress' } })).toBe(1)
  })

  it('est limité à 3 requêtes par minute et par IP (§7.1)', async () => {
    const { tokens } = await bothAnswered()
    for (let i = 0; i < 3; i++) await (await api()).post(`/relay/${tokens.contact1}/confirm`)
    const r = await (await api()).post(`/relay/${tokens.contact1}/confirm`).expect(429)
    expect(r.body.error.code).toBe('RATE_LIMITED')
  })
})
