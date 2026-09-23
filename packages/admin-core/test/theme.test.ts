// Apparence du back office : thème du navigateur par défaut, réglage manuel
// (système, clair, sombre) mémorisé. Résolution pure, testée sous Node.
import { describe, expect, it } from 'vitest'
import { parseThemePreference, resolveTheme, THEME_PREFERENCES } from '../src/theme.js'

describe('resolveTheme', () => {
  it('« système » suit le navigateur, sinon la préférence l’emporte', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('parseThemePreference', () => {
  it('lit ce qui est stocké, retombe sur « système » pour tout le reste', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('system')).toBe('system')
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference('sepia')).toBe('system')
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark'])
  })
})
