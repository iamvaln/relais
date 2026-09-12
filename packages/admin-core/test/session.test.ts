// Session du back office : jeton 8 h dans un SessionStore (sessionStorage
// dans le navigateur, mémoire ici), jamais de refresh ; restauration au
// chargement validée par GET /admin/me ; expiration locale respectée sans
// appel réseau ; 401 → session oubliée.
import { describe, expect, it } from 'vitest'
import { AdminClient } from '../src/client.js'
import { AdminSession, MemorySessionStore } from '../src/session.js'

const ADMIN = { id: 'a1', email: 'v@relais.app', full_name: 'Valentine', role: 'super_admin' }

/** Un faux serveur : enregistre les appels, répond selon le chemin. */
function fakeApi(handlers: Record<string, (init: RequestInit) => { status: number; body: unknown }>) {
  const calls: { path: string; auth: string | null }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    calls.push({ path: url.pathname, auth: headers.get('authorization') })
    const h = handlers[url.pathname]
    const r = h ? h(init ?? {}) : { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'nope' } } }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetchImpl }
}

describe('AdminSession', () => {
  it('login : POST /admin/auth/login, jeton et admin gardés avec l’échéance ; logout : POST /admin/auth/logout, tout oublié', async () => {
    const api = fakeApi({
      '/admin/auth/login': () => ({ status: 200, body: { success: true, data: { access_token: 'tok', expires_in: 28800, admin: ADMIN } } }),
      '/admin/auth/logout': () => ({ status: 200, body: { success: true, data: { logged_out: true } } }),
    })
    const store = new MemorySessionStore()
    const now = 1_700_000_000_000
    const session = new AdminSession({ client: new AdminClient({ baseUrl: 'http://api', fetch: api.fetchImpl }), store, now: () => now })
    expect(session.admin).toBeNull()

    const admin = await session.login({ email: ADMIN.email, password: 'pw', code: '123456' })
    expect(admin).toEqual(ADMIN)
    expect(session.admin).toEqual(ADMIN)
    expect(store.get()).toEqual({ token: 'tok', expiresAt: now + 28_800_000, admin: ADMIN })

    await session.logout()
    expect(api.calls.at(-1)).toEqual({ path: '/admin/auth/logout', auth: 'Bearer tok' })
    expect(session.admin).toBeNull()
    expect(store.get()).toBeNull()
  })

  it('restore : rien en réserve → null sans appel ; jeton expiré → oublié sans appel ; jeton valide → GET /admin/me', async () => {
    const api = fakeApi({ '/admin/me': () => ({ status: 200, body: { success: true, data: ADMIN } }) })
    const store = new MemorySessionStore()
    const now = 1_700_000_000_000
    const mk = () => new AdminSession({ client: new AdminClient({ baseUrl: 'http://api', fetch: api.fetchImpl }), store, now: () => now })

    expect(await mk().restore()).toBeNull()
    expect(api.calls).toHaveLength(0)

    store.set({ token: 'vieux', expiresAt: now - 1, admin: ADMIN })
    expect(await mk().restore()).toBeNull()
    expect(store.get()).toBeNull()
    expect(api.calls).toHaveLength(0)

    store.set({ token: 'tok', expiresAt: now + 60_000, admin: ADMIN })
    const s = mk()
    expect(await s.restore()).toEqual(ADMIN)
    expect(api.calls).toEqual([{ path: '/admin/me', auth: 'Bearer tok' }])
    expect(s.admin).toEqual(ADMIN)
  })

  it('un 401 (jeton révoqué côté serveur) ferme la session : store vidé, onSessionLost appelé, jamais de refresh', async () => {
    const api = fakeApi({
      '/admin/me': () => ({ status: 401, body: { success: false, error: { code: 'AUTH_TOKEN_INVALID', message: 'révoqué' } } }),
    })
    const store = new MemorySessionStore()
    store.set({ token: 'tok', expiresAt: Date.now() + 60_000, admin: ADMIN })
    let lost = 0
    const session = new AdminSession({ client: new AdminClient({ baseUrl: 'http://api', fetch: api.fetchImpl, onSessionLost: () => lost++ }), store })
    expect(await session.restore()).toBeNull()
    expect(store.get()).toBeNull()
    expect(lost).toBe(1)
    expect(api.calls.map((c) => c.path)).toEqual(['/admin/me']) // pas de POST /auth/refresh
  })
})
