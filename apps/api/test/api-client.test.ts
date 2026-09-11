// @relais/api-client contre la vraie API (le serveur écoute sur un port
// éphémère) : enveloppe, erreurs typées, bearer, refresh automatique sur 401,
// méthodes d'auth. C'est le client que l'app mobile et le back office web
// utiliseront tel quel.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiClient, ApiError, MemoryCookieJar } from '@relais/api-client'
import { getApp, lastOtp, resetState, closeAll, STRONG_PASSWORD } from './helpers.js'

let baseUrl = ''

beforeAll(async () => {
  const app = await getApp()
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' })
})
beforeEach(resetState)
afterAll(closeAll)

function client() {
  return new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' })
}

describe('enveloppe et erreurs', () => {
  it('déballe { success, data } et lève ApiError { status, code, message, details } sinon', async () => {
    const c = client()
    const health = await c.get<{ status: string }>('/health')
    expect(health.status).toBe('ok')
    const err = await c.post('/auth/login', { email: 'pas-un-email', password: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
    expect((err as ApiError).message.length).toBeGreaterThan(0)
    const notFound = await c.get('/nulle-part').catch((e: unknown) => e)
    expect(notFound).toMatchObject({ status: 404 })
  })
})

describe('auth', () => {
  it('inscription → OTP → session ; me ; refresh automatique quand l’access token meurt ; logout', async () => {
    const c = client()
    expect(await c.auth.register({ full_name: 'Adjoua Ngo', email: 'adjoua@example.cm', phone: '+237699000000', password: STRONG_PASSWORD, language: 'fr' })).toEqual({ pending: true })
    expect(c.accessToken).toBeNull()
    const session = await c.auth.verifyEmail({ email: 'adjoua@example.cm', code: lastOtp() })
    expect(session.user.email).toBe('adjoua@example.cm')
    expect(c.accessToken).toBe(session.access_token)
    expect((await c.auth.me()).email).toBe('adjoua@example.cm')

    // Access token périmé ou invalide : le client rafraîchit une fois via le cookie et rejoue
    c.accessToken = 'périmé'
    const me = await c.auth.me()
    expect(me.email).toBe('adjoua@example.cm')
    expect(c.accessToken).not.toBe('périmé')

    await c.auth.logout()
    expect(c.accessToken).toBeNull()
    const after = await c.auth.me().catch((e: unknown) => e)
    expect(after).toMatchObject({ status: 401 })
  })

  it('login puis step-up : le jeton part dans X-Step-Up-Token', async () => {
    const c = client()
    await c.auth.register({ full_name: 'Adjoua Ngo', email: 'adjoua@example.cm', phone: '+237699000000', password: STRONG_PASSWORD })
    await c.auth.verifyEmail({ email: 'adjoua@example.cm', code: lastOtp() })
    const other = client()
    const login = await other.auth.login({ email: 'adjoua@example.cm', password: STRONG_PASSWORD })
    expect(login.requires_2fa).toBeFalsy()
    expect(other.accessToken).toBeTruthy()
    const su = await other.auth.stepUp('view_seed')
    expect(su.action).toBe('view_seed')
    const authorized = await other.post<{ authorized: boolean }>('/auth/seed/display', {}, { stepUpToken: su.step_up_token })
    expect(authorized.authorized).toBe(true)
    const denied = await other.post('/auth/seed/display', {}).catch((e: unknown) => e)
    expect(denied).toMatchObject({ status: 403, code: 'AUTH_STEPUP_REQUIRED' })
  })
})
