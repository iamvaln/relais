// sessionStorage (décision du 12/09/2026) : survit au rechargement de
// l'onglet, disparaît à sa fermeture. Jamais localStorage.
import type { SessionStore, StoredSession } from '@relais/admin-core'

const KEY = 'relais-admin-session'

export class BrowserSessionStore implements SessionStore {
  get(): StoredSession | null {
    try {
      const raw = sessionStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as StoredSession) : null
    } catch {
      return null
    }
  }
  set(session: StoredSession): void {
    sessionStorage.setItem(KEY, JSON.stringify(session))
  }
  clear(): void {
    sessionStorage.removeItem(KEY)
  }
}
