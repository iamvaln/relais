// Push OneSignal (lot 5 mobile, décision du 12/09/2026, docs/mobile.md §3) :
// l'app enregistre son identifiant d'abonnement, l'API pousse par l'API REST
// OneSignal en ciblant external_id = SHA256(user_id). Jamais d'email, de nom
// ni de contenu utilisateur dans une notification ; rien n'est tracé en base.

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/lib/crypto.js'
import { prisma } from '../src/lib/prisma.js'
import { OneSignalTransport, pushExternalId, pushService } from '../src/services/push/index.js'
import { api, closeAll, pushbox, registerUser, resetState } from './helpers.js'

beforeEach(resetState)
afterAll(closeAll)

describe('POST / DELETE /auth/push-token', () => {
  it('enregistre l’identifiant d’abonnement du device, le réattribue si un autre compte le présente, le désactive au retrait', async () => {
    const a = await registerUser('adjoua@example.cm')
    const b = await registerUser('herve@example.cm')
    const client = await api()
    const r = await client.post('/auth/push-token').set('Authorization', `Bearer ${a.accessToken}`).send({ token: 'sub_0123456789', platform: 'android' }).expect(200)
    expect(r.body.data).toEqual({ registered: true })
    let rows = await prisma().push_tokens.findMany({ where: { token: 'sub_0123456789' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: a.userId, platform: 'android', active: true })

    // Même device, autre compte connecté : le token change de main, il n'en reste qu'un
    await client.post('/auth/push-token').set('Authorization', `Bearer ${b.accessToken}`).send({ token: 'sub_0123456789', platform: 'android' }).expect(200)
    rows = await prisma().push_tokens.findMany({ where: { token: 'sub_0123456789' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: b.userId, active: true })

    await client.delete('/auth/push-token').set('Authorization', `Bearer ${b.accessToken}`).send({ token: 'sub_0123456789' }).expect(200)
    rows = await prisma().push_tokens.findMany({ where: { token: 'sub_0123456789' } })
    expect(rows[0]).toMatchObject({ user_id: b.userId, active: false })
    // Retirer le token d'un autre compte ne fait rien
    await client.delete('/auth/push-token').set('Authorization', `Bearer ${a.accessToken}`).send({ token: 'sub_0123456789' }).expect(200)
  })

  it('exige une session et une plateforme connue', async () => {
    const a = await registerUser('adjoua@example.cm')
    await (await api()).post('/auth/push-token').send({ token: 'x', platform: 'android' }).expect(401)
    await (await api()).post('/auth/push-token').set('Authorization', `Bearer ${a.accessToken}`).send({ token: 'x', platform: 'web' }).expect(400)
  })
})

describe('pushService', () => {
  it('external_id = SHA256(user_id) ; envoie seulement si le compte a un abonnement actif ; jamais d’email ni de nom dans la charge', async () => {
    const a = await registerUser('adjoua@example.cm', { name: 'Adjoua Ngo' })
    expect(pushExternalId(a.userId)).toBe(sha256Hex(a.userId))
    pushbox.clear()
    expect(await pushService().send({ userId: a.userId, type: 'checkin_due', locale: 'fr' })).toEqual({ sent: false, reason: 'no_subscription' })
    expect(pushbox.sent).toHaveLength(0)

    await (await api()).post('/auth/push-token').set('Authorization', `Bearer ${a.accessToken}`).send({ token: 'sub_1', platform: 'ios' }).expect(200)
    expect(await pushService().send({ userId: a.userId, type: 'checkin_due', locale: 'fr' })).toEqual({ sent: true })
    expect(pushbox.sent).toHaveLength(1)
    const msg = pushbox.sent[0]!
    expect(msg.externalId).toBe(sha256Hex(a.userId))
    expect(msg.route).toBe('/checkin')
    expect(msg.title).toBe('Un petit signe ?')
    const serialized = JSON.stringify(msg)
    for (const clear of ['adjoua', 'Adjoua', 'Ngo', a.userId]) expect(serialized.includes(clear)).toBe(false)
  })

  it('un abonnement désactivé ne reçoit plus rien', async () => {
    const a = await registerUser('adjoua@example.cm')
    await (await api()).post('/auth/push-token').set('Authorization', `Bearer ${a.accessToken}`).send({ token: 'sub_1', platform: 'ios' }).expect(200)
    await (await api()).delete('/auth/push-token').set('Authorization', `Bearer ${a.accessToken}`).send({ token: 'sub_1' }).expect(200)
    pushbox.clear()
    expect(await pushService().send({ userId: a.userId, type: 'checkin_relance_1', locale: 'en' })).toEqual({ sent: false, reason: 'no_subscription' })
  })
})

describe('OneSignalTransport', () => {
  let server: Server
  let addr: string
  const requests: { path: string; auth: string | undefined; body: Record<string, unknown> }[] = []
  let status = 200

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        requests.push({ path: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> })
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(status === 200 ? { id: 'notif_1' } : { errors: ['invalid app_id'] }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const a = server.address()
    if (!a || typeof a === 'string') throw new Error('adresse')
    addr = `http://127.0.0.1:${a.port}`
  })
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('POST /notifications avec la clé REST, l’app_id, l’alias external_id, les textes FR et EN et la route', async () => {
    status = 200
    const t = new OneSignalTransport({ appId: 'app_123', restApiKey: 'rest_secret', apiUrl: addr })
    const r = await t.send({ externalId: 'abc', title: 'Un petit signe ?', body: 'Ton check-in Relais t’attend.', route: '/checkin' })
    expect(r).toEqual({ providerId: 'notif_1' })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe('/notifications')
    expect(requests[0]!.auth).toBe('Key rest_secret')
    expect(requests[0]!.body).toEqual({
      app_id: 'app_123',
      target_channel: 'push',
      include_aliases: { external_id: ['abc'] },
      headings: { en: 'Un petit signe ?' },
      contents: { en: 'Ton check-in Relais t’attend.' },
      data: { route: '/checkin' },
    })
  })

  it('une réponse d’erreur de OneSignal lève, sans exposer la clé', async () => {
    status = 400
    const t = new OneSignalTransport({ appId: 'app_123', restApiKey: 'rest_secret', apiUrl: addr })
    await expect(t.send({ externalId: 'abc', title: 'x', body: 'y', route: '/checkin' })).rejects.toThrow(/OneSignal.*400/)
    await expect(t.send({ externalId: 'abc', title: 'x', body: 'y', route: '/checkin' })).rejects.not.toThrow(/rest_secret/)
  })
})
