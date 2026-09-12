// Client HTTP de l'API Relais.
//
// - enveloppe déballée, erreurs typées (ApiError) ;
// - Authorization: Bearer <access token> quand il y en a un ;
// - 401 AUTH_TOKEN_EXPIRED / AUTH_TOKEN_INVALID → un refresh (cookie), puis
//   la requête est rejouée une fois ; si le refresh échoue, la session est
//   fermée côté client et l'erreur d'origine remonte ;
// - X-Step-Up-Token quand l'appelant en fournit un (DEC-25) ;
// - Accept-Language pour les messages FR/EN.

import { type CookieJar, NativeCookieJar } from './cookies.js'
import { ApiError, type ApiErrorBody, NetworkError } from './errors.js'

export interface ApiClientOptions {
  baseUrl: string
  cookieJar?: CookieJar
  language?: 'fr' | 'en'
  fetch?: typeof fetch
  /** Appelé quand la session n'est plus récupérable (refresh refusé) : l'app renvoie au login. */
  onSessionLost?: () => void
}

export interface RequestOptions {
  stepUpToken?: string
  headers?: Record<string, string>
  /** Ne pas tenter de refresh sur 401 (utilisé par le refresh lui-même et le login). */
  noRefresh?: boolean
}

type Envelope<T> = { success: true; data: T } | { success: false; error: ApiErrorBody }

const REFRESH_PATH = '/auth/refresh'
const REFRESHABLE = new Set(['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_INVALID'])

export class ApiClient {
  readonly baseUrl: string
  accessToken: string | null = null
  private readonly jar: CookieJar
  private readonly language: 'fr' | 'en'
  private readonly fetchImpl: typeof fetch
  private readonly onSessionLost: (() => void) | undefined
  private refreshing: Promise<boolean> | null = null

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.jar = options.cookieJar ?? new NativeCookieJar()
    this.language = options.language ?? 'fr'
    // Détaché de l'instance : dans un navigateur, window.fetch appelé comme méthode d'un autre objet lève « Illegal invocation ».
    const impl = options.fetch ?? fetch
    this.fetchImpl = (input, init) => impl(input, init)
    this.onSessionLost = options.onSessionLost
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, options)
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, body, options)
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, body, options)
  }

  delete<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, body, options)
  }

  /** Oublie la session côté client (token et cookies). */
  forgetSession(): void {
    this.accessToken = null
    this.jar.clear()
  }

  async request<T>(method: string, path: string, body: unknown, options: RequestOptions): Promise<T> {
    try {
      return await this.send<T>(method, path, body, options)
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401 || !REFRESHABLE.has(err.code) || options.noRefresh) throw err
      if (!(await this.refresh())) {
        this.forgetSession()
        this.onSessionLost?.()
        throw err
      }
      return this.send<T>(method, path, body, { ...options, noRefresh: true })
    }
  }

  /** Un seul refresh à la fois : les requêtes concurrentes attendent le même. */
  private refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const data = await this.send<{ access_token: string }>('POST', REFRESH_PATH, undefined, { noRefresh: true })
        this.accessToken = data.access_token
        return true
      } catch {
        return false
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  private async send<T>(method: string, path: string, body: unknown, options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': this.language, ...options.headers }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`
    if (options.stepUpToken) headers['X-Step-Up-Token'] = options.stepUpToken
    const cookie = this.jar.header(url)
    if (cookie) headers['Cookie'] = cookie

    let res: Response
    try {
      res = await this.fetchImpl(url, { method, headers, body: body === undefined ? null : JSON.stringify(body), credentials: 'include' })
    } catch (err) {
      throw new NetworkError(err)
    }
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    if (setCookies.length > 0) this.jar.store(url, setCookies)

    let parsed: Envelope<T> | null = null
    const text = await res.text()
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as Envelope<T>
      } catch {
        parsed = null
      }
    }
    if (parsed && parsed.success === true) return parsed.data
    if (parsed && parsed.success === false) throw new ApiError(res.status, parsed.error)
    throw new ApiError(res.status, { code: res.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR', message: res.ok ? 'Réponse inattendue.' : `HTTP ${res.status}` })
  }
}
