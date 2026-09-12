// Session du back office (décision du 12/09/2026) : le jeton 8 h vit dans un
// SessionStore — sessionStorage dans le navigateur (survit au rechargement,
// disparaît avec l'onglet), mémoire dans les tests — et GET /admin/me le
// revalide au chargement. Un jeton expiré localement est oublié sans appel.

import { ApiError } from '@relais/api-client'
import type { AdminClient } from './client.js'
import type { AdminView } from './types.js'

export interface StoredSession {
  token: string
  /** Époque ms : issue de expires_in au login. */
  expiresAt: number
  admin: AdminView
}

export interface SessionStore {
  get(): StoredSession | null
  set(session: StoredSession): void
  clear(): void
}

export class MemorySessionStore implements SessionStore {
  private value: StoredSession | null = null
  get(): StoredSession | null {
    return this.value
  }
  set(session: StoredSession): void {
    this.value = session
  }
  clear(): void {
    this.value = null
  }
}

export interface AdminSessionDeps {
  client: AdminClient
  store: SessionStore
  now?: () => number
}

export class AdminSession {
  private current: AdminView | null = null
  private readonly now: () => number

  constructor(private readonly deps: AdminSessionDeps) {
    this.now = deps.now ?? Date.now
  }

  get admin(): AdminView | null {
    return this.current
  }

  async login(input: { email: string; password: string; code: string }): Promise<AdminView> {
    const r = await this.deps.client.login(input)
    this.deps.client.token = r.access_token
    this.deps.store.set({ token: r.access_token, expiresAt: this.now() + r.expires_in * 1000, admin: r.admin })
    this.current = r.admin
    return r.admin
  }

  /** Au chargement de la page : reprend la session gardée si elle n'est pas expirée et que le serveur la reconnaît encore. */
  async restore(): Promise<AdminView | null> {
    const stored = this.deps.store.get()
    if (!stored) return null
    if (stored.expiresAt <= this.now()) {
      this.forget()
      return null
    }
    this.deps.client.token = stored.token
    try {
      this.current = await this.deps.client.me()
      return this.current
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.forget()
        return null
      }
      throw err
    }
  }

  async logout(): Promise<void> {
    try {
      await this.deps.client.logout()
    } finally {
      this.forget()
    }
  }

  private forget(): void {
    this.deps.client.token = null
    this.deps.store.clear()
    this.current = null
  }
}
