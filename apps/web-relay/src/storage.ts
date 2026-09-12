// La progression « Fait » du contact, dans localStorage — sous le hachage du
// token (RelayProgress), jamais le token lui-même ni une donnée en clair.
import type { SecureStorage } from '@relais/app-core'

export class BrowserStorage implements SecureStorage {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key)
  }
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value)
  }
  async delete(key: string): Promise<void> {
    localStorage.removeItem(key)
  }
}
