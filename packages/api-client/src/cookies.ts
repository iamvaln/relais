// Le refresh token est un cookie HttpOnly (Path=/auth/refresh). Sur iOS et
// Android, fetch de React Native le garde tout seul : CookieJar y est un
// no-op. Sous Node (tests, scripts), MemoryCookieJar le porte.

export interface CookieJar {
  /** En-tête Cookie à joindre à cette URL, ou null. */
  header(url: string): string | null
  /** Enregistre les Set-Cookie d'une réponse. */
  store(url: string, setCookies: string[]): void
  clear(): void
}

export class NativeCookieJar implements CookieJar {
  header(): string | null {
    return null
  }
  store(): void {}
  clear(): void {}
}

interface StoredCookie {
  value: string
  path: string
  expires: number | null
}

export class MemoryCookieJar implements CookieJar {
  private readonly cookies = new Map<string, StoredCookie>()

  header(url: string): string | null {
    const path = new URL(url).pathname
    const now = Date.now()
    const pairs: string[] = []
    for (const [name, c] of this.cookies) {
      if (c.expires !== null && c.expires < now) continue
      if (!path.startsWith(c.path)) continue
      pairs.push(`${name}=${c.value}`)
    }
    return pairs.length > 0 ? pairs.join('; ') : null
  }

  store(_url: string, setCookies: string[]): void {
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim())
      if (!pair) continue
      const eq = pair.indexOf('=')
      const name = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      let path = '/'
      let expires: number | null = null
      for (const a of attrs) {
        const [k, v] = a.split('=').map((s) => s.trim()) as [string, string | undefined]
        if (k.toLowerCase() === 'path' && v) path = v
        if (k.toLowerCase() === 'max-age' && v) expires = Date.now() + Number(v) * 1000
        if (k.toLowerCase() === 'expires' && v && expires === null) expires = Date.parse(v)
      }
      if (value === '' || (expires !== null && expires <= Date.now())) this.cookies.delete(name)
      else this.cookies.set(name, { value, path, expires })
    }
  }

  clear(): void {
    this.cookies.clear()
  }
}
