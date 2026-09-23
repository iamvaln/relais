// L'état partagé des écrans : session (admin-core), langue, perte de session.
import { AdminClient, AdminSession, parseThemePreference, type AdminView, type ThemePreference } from '@relais/admin-core'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { browserLang, type Key, type Lang, t as translate } from './i18n'
import { BrowserSessionStore } from './session-store'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const LANG_KEY = 'relais-admin-lang'
const THEME_KEY = 'relais-admin-theme'

interface AppState {
  client: AdminClient
  session: AdminSession
  admin: AdminView | null
  ready: boolean
  lostNotice: boolean
  lang: Lang
  setLang: (lang: Lang) => void
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
  t: (key: Key, params?: Record<string, string | number>) => string
  login: (input: { email: string; password: string; code: string }) => Promise<AdminView>
  logout: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

function initialLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY)
  if (stored === 'fr' || stored === 'en') return stored
  return browserLang(navigator.language)
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminView | null>(null)
  const [ready, setReady] = useState(false)
  const [lostNotice, setLostNotice] = useState(false)
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [theme, setThemeState] = useState<ThemePreference>(() => parseThemePreference(localStorage.getItem(THEME_KEY)))

  const { client, session } = useMemo(() => {
    const store = new BrowserSessionStore()
    const client = new AdminClient({
      baseUrl: API_URL,
      onSessionLost: () => {
        store.clear()
        setAdmin(null)
        setLostNotice(true)
      },
    })
    return { client, session: new AdminSession({ client, store }) }
  }, [])

  useEffect(() => {
    void session
      .restore()
      .then((a) => setAdmin(a))
      .catch(() => setAdmin(null))
      .finally(() => setReady(true))
  }, [session])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(LANG_KEY, next)
    setLangState(next)
  }, [])

  // Apparence : « système » laisse `prefers-color-scheme` décider ; clair ou sombre s'impose via data-theme (styles.css).
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [theme])

  const setTheme = useCallback((next: ThemePreference) => {
    localStorage.setItem(THEME_KEY, next)
    setThemeState(next)
  }, [])

  const value = useMemo<AppState>(
    () => ({
      client,
      session,
      admin,
      ready,
      lostNotice,
      lang,
      setLang,
      theme,
      setTheme,
      t: (key, params) => translate(lang, key, params),
      login: async (input) => {
        const a = await session.login(input)
        setLostNotice(false)
        setAdmin(a)
        return a
      },
      logout: async () => {
        await session.logout().catch(() => undefined)
        setAdmin(null)
      },
    }),
    [client, session, admin, ready, lostNotice, lang, setLang, theme, setTheme],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp hors AppStateProvider')
  return ctx
}
