// Apparence : le thème du navigateur par défaut, un réglage manuel possible.
// Pur : le back office pose `data-theme` sur la racine, le CSS fait le reste.

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

/** « système » suit `prefers-color-scheme` ; sinon la préférence l'emporte. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

/** Ce qui est stocké dans le navigateur ; tout ce qui n'est pas connu redonne « système ». */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}
