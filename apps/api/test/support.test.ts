// Tickets support (Back Office BO-02 cas 1, 2 et 4 ; dashboard BO-01).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { api, closeAll, registerUser, resetState } from './helpers.js'

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
