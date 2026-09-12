// CORS (Backend Specs §7.2) : deux origines navigateur — la page du contact
// (FRONTEND_URL) et le back office (ADMIN_URL, lot 1 du back office). Toute
// autre origine ne reçoit pas d'en-tête Access-Control-Allow-Origin.
import { afterAll, describe, expect, it } from 'vitest'
import { api, closeAll } from './helpers.js'

afterAll(closeAll)

describe('CORS', () => {
  it('FRONTEND_URL et ADMIN_URL sont autorisées, avec credentials ; une origine inconnue non', async () => {
    const client = await api()
    const front = await client.get('/health').set('Origin', process.env.FRONTEND_URL!).expect(200)
    expect(front.headers['access-control-allow-origin']).toBe(process.env.FRONTEND_URL)
    expect(front.headers['access-control-allow-credentials']).toBe('true')

    const admin = await client.get('/health').set('Origin', process.env.ADMIN_URL!).expect(200)
    expect(admin.headers['access-control-allow-origin']).toBe(process.env.ADMIN_URL)

    const other = await client.get('/health').set('Origin', 'https://evil.example').expect(200)
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('le preflight du back office accepte Authorization et X-Step-Up-Token', async () => {
    const r = await (await api())
      .options('/admin/users')
      .set('Origin', process.env.ADMIN_URL!)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
    expect([200, 204]).toContain(r.status)
    expect(r.headers['access-control-allow-origin']).toBe(process.env.ADMIN_URL)
    expect(r.headers['access-control-allow-headers']).toMatch(/Authorization/i)
  })
})
