// Tickets support (Back Office BO-02 cas 1, 2 et 4 ; dashboard BO-01).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { loginAdmin } from './admin-helpers.js'
import { api, closeAll, lastEmailTo, mailbox, registerUser, resetState } from './helpers.js'

beforeEach(resetState)
afterAll(closeAll)

const TICKET = { email: 'adjoua@example.cm', subject: 'Compte bloqué', body: 'Je n’arrive plus à me connecter depuis hier.', category: 'account_locked' }

describe('POST /support/tickets — sans compte connecté', () => {
  it('crée un ticket avec un email ; rattaché au compte si l’email existe, sans le dire', async () => {
    const u = await registerUser('adjoua@example.cm')
    const r = await (await api()).post('/support/tickets').send(TICKET).expect(201)
    expect(r.body.data).toMatchObject({ subject: 'Compte bloqué', category: 'account_locked', status: 'open', priority: 'normal' })
    expect(r.body.data.id).toBeTypeOf('string')
    expect(r.body.data.user_id).toBeUndefined()
    expect(r.body.data.email).toBeUndefined()
    const row = await prisma().support_tickets.findUniqueOrThrow({ where: { id: r.body.data.id } })
    expect(row).toMatchObject({ user_id: u.userId, user_email: 'adjoua@example.cm', body: TICKET.body })

    // email inconnu : même réponse, ticket sans compte
    const anon = await (await api()).post('/support/tickets').send({ ...TICKET, email: 'Inconnu@Example.cm', category: 'otp_issue' }).expect(201)
    const row2 = await prisma().support_tickets.findUniqueOrThrow({ where: { id: anon.body.data.id } })
    expect(row2).toMatchObject({ user_id: null, user_email: 'inconnu@example.cm', category: 'otp_issue' })
    // ni email ni token
    const r3 = await (await api()).post('/support/tickets').send({ subject: 's', body: 'b', category: 'other' }).expect(400)
    expect(r3.body.error.details.email).toBeDefined()
  })

  it('valide le corps : catégorie inconnue, sujet vide, corps trop long → 400 (la limite par IP compte aussi ces essais)', async () => {
    const client = await api()
    await client.post('/support/tickets').send({ ...TICKET, category: 'astrology' }).expect(400)
    await client.post('/support/tickets').send({ ...TICKET, subject: '' }).expect(400)
    await client.post('/support/tickets').send({ ...TICKET, body: 'x'.repeat(5001) }).expect(400)
  })

  it('est limité à 3 tickets par heure et par IP', async () => {
    const client = await api()
    for (let i = 0; i < 3; i++) await client.post('/support/tickets').send({ ...TICKET, email: `spam${i}@example.cm` }).expect(201)
    const r = await client.post('/support/tickets').send({ ...TICKET, email: 'spam3@example.cm' }).expect(429)
    expect(r.body.error.code).toBe('RATE_LIMITED')
  })
})

describe('POST /support/tickets — connecté', () => {
  it('prend l’identité du token, ignore l’email envoyé ; GET liste ses tickets, jamais ceux des autres', async () => {
    const a = await registerUser('a@example.cm')
    const b = await registerUser('b@example.cm')
    const authA = { Authorization: `Bearer ${a.accessToken}` }
    const r = await (await api()).post('/support/tickets').set(authA).send({ subject: 'Abonnement', body: 'Question sur le prix', category: 'subscription', email: 'autre@example.cm' }).expect(201)
    const row = await prisma().support_tickets.findUniqueOrThrow({ where: { id: r.body.data.id } })
    expect(row).toMatchObject({ user_id: a.userId, user_email: 'a@example.cm' })
    await (await api()).post('/support/tickets').set({ Authorization: `Bearer ${b.accessToken}` }).send({ subject: 'B', body: 'b', category: 'other' }).expect(201)

    const list = await (await api()).get('/support/tickets').set(authA).expect(200)
    expect(list.body.data).toHaveLength(1)
    expect(list.body.data[0]).toMatchObject({ id: r.body.data.id, subject: 'Abonnement', status: 'open', resolution_note: null })
    expect(list.body.data[0].body).toBe('Question sur le prix')
    await (await api()).get('/support/tickets').expect(401)
  })
})

// --- Côté back office (BO-02, rôle support) ---------------------------------------------

async function seedTickets() {
  const u = await registerUser('adjoua@example.cm')
  const client = await api()
  const t1 = (await client.post('/support/tickets').send({ ...TICKET, category: 'account_locked' }).expect(201)).body.data
  const t2 = (await client.post('/support/tickets').send({ ...TICKET, email: 'x@example.cm', subject: 'OTP', category: 'otp_issue' }).expect(201)).body.data
  return { u, t1, t2 }
}

describe('GET /admin/tickets et /admin/tickets/:id', () => {
  it('liste filtrable par statut, priorité, catégorie ; détail avec l’email du demandeur (support) ; finance refusé', async () => {
    const { u, t1, t2 } = await seedTickets()
    const support = await loginAdmin('support')
    const finance = await loginAdmin('finance')
    await (await api()).get('/admin/tickets').set(finance.auth).expect(403)

    const all = await (await api()).get('/admin/tickets').set(support.auth).expect(200)
    expect(all.body.data.total).toBe(2)
    expect(all.body.data.items.map((t: { id: string }) => t.id).sort()).toEqual([t1.id, t2.id].sort())
    const otp = await (await api()).get('/admin/tickets?category=otp_issue').set(support.auth).expect(200)
    expect(otp.body.data.items).toHaveLength(1)
    expect(otp.body.data.items[0]).toMatchObject({ id: t2.id, user_id: null, user_email: 'x@example.cm' })

    const one = await (await api()).get(`/admin/tickets/${t1.id}`).set(support.auth).expect(200)
    expect(one.body.data).toMatchObject({ id: t1.id, user_id: u.userId, user_email: 'adjoua@example.cm', body: TICKET.body, assigned_to: null })
    await (await api()).get('/admin/tickets/00000000-0000-4000-8000-000000000000').set(support.auth).expect(404)
  })
})

describe('PUT /admin/tickets/:id', () => {
  it('prend en charge, priorise, résout avec une note ; resolved_at posé ; TICKET_UPDATE audité avant/après ; visible par l’utilisateur', async () => {
    const { u, t1 } = await seedTickets()
    const support = await loginAdmin('support')

    const taken = await (await api()).put(`/admin/tickets/${t1.id}`).set(support.auth).send({ status: 'in_progress', priority: 'high', assigned_to: support.id }).expect(200)
    expect(taken.body.data).toMatchObject({ status: 'in_progress', priority: 'high', assigned_to: support.id, resolved_at: null })

    const before = Date.now()
    mailbox.clear()
    const done = await (await api()).put(`/admin/tickets/${t1.id}`).set(support.auth).send({ status: 'resolved', resolution_note: 'Compte débloqué, email envoyé.' }).expect(200)
    expect(done.body.data.status).toBe('resolved')
    expect(Date.parse(done.body.data.resolved_at)).toBeGreaterThanOrEqual(before - 1000)
    // Point ouvert (12/09/2026) : le demandeur est prévenu, avec la note
    const mail = lastEmailTo('adjoua@example.cm')
    expect(mail?.subject).toBe('Relais — votre demande « Compte bloqué » est résolue')
    expect(mail?.text).toContain('Compte débloqué, email envoyé.')
    expect(await prisma().email_log.count({ where: { user_id: u.userId, email_type: 'ticket_resolved' } })).toBe(1)

    const logs = await prisma().audit_logs.findMany({ where: { action: 'TICKET_UPDATE', target_id: t1.id }, orderBy: { created_at: 'asc' } })
    expect(logs).toHaveLength(2)
    expect(logs[0]!.value_before).toMatchObject({ status: 'open', priority: 'normal', assigned_to: null })
    expect(logs[0]!.value_after).toMatchObject({ status: 'in_progress', priority: 'high', assigned_to: support.id })
    expect(logs[1]!.value_after).toMatchObject({ status: 'resolved' })
    expect(logs[0]).toMatchObject({ admin_id: support.id, user_id: u.userId })
    expect(JSON.stringify(logs)).not.toContain('example.cm')

    const mine = await (await api()).get('/support/tickets').set({ Authorization: `Bearer ${u.accessToken}` }).expect(200)
    expect(mine.body.data[0]).toMatchObject({ status: 'resolved', resolution_note: 'Compte débloqué, email envoyé.' })

    await (await api()).put(`/admin/tickets/${t1.id}`).set(support.auth).send({}).expect(400)
    await (await api()).put(`/admin/tickets/${t1.id}`).set(support.auth).send({ assigned_to: '00000000-0000-4000-8000-000000000000' }).expect(404)

    // Passer à fermé n'envoie rien de plus
    mailbox.clear()
    await (await api()).put(`/admin/tickets/${t1.id}`).set(support.auth).send({ status: 'closed' }).expect(200)
    expect(mailbox.sent).toHaveLength(0)
  })
})
