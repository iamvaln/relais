// Apparence : thème du système par défaut, réglage manuel mémorisé sur le device.
// Logique pure (résolution, palette, préférence) testée sous Node.

import { describe, expect, it } from 'vitest'
import { PALETTES, paletteFor, parsePreference, resolveScheme } from '../src/lib/theme'
import { createThemeStore, THEME_KEY } from '../src/state/theme'

describe('resolveScheme', () => {
  it('« système » suit le téléphone, sinon la préférence l’emporte ; sans info → clair', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark')
    expect(resolveScheme('system', 'light')).toBe('light')
    expect(resolveScheme('system', null)).toBe('light')
    expect(resolveScheme('system', undefined)).toBe('light')
    expect(resolveScheme('system', 'unspecified')).toBe('light')
    expect(resolveScheme('dark', 'light')).toBe('dark')
    expect(resolveScheme('light', 'dark')).toBe('light')
  })
})

describe('paletteFor', () => {
  it('les deux palettes ont les mêmes jetons, le doré ne change pas, le fond et l’encre s’inversent', () => {
    const light = paletteFor('light')
    const dark = paletteFor('dark')
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
    expect(dark.accent).toBe(light.accent)
    expect(dark.bg).not.toBe(light.bg)
    expect(dark.ink).not.toBe(light.ink)
    // marque de la landing : crème et encre, plus de vert
    expect(light.bg).toBe('#faf8f5')
    expect(light.ink).toBe('#2a1f12')
    expect(PALETTES.light).toBe(light)
  })
})

describe('parsePreference', () => {
  it('lit ce qui est stocké, retombe sur « système » pour tout le reste', () => {
    expect(parsePreference('dark')).toBe('dark')
    expect(parsePreference('light')).toBe('light')
    expect(parsePreference('system')).toBe('system')
    expect(parsePreference(null)).toBe('system')
    expect(parsePreference('bleu')).toBe('system')
  })
})

describe('themeStore', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return {
      data: m,
      get: async (k: string) => m.get(k) ?? null,
      set: async (k: string, v: string) => void m.set(k, v),
    }
  }

  it('démarre sur « système », relit la préférence stockée, la persiste quand elle change', async () => {
    const storage = memory()
    const store = createThemeStore(storage)
    expect(store.getState().preference).toBe('system')

    await store.getState().setPreference('dark')
    expect(store.getState().preference).toBe('dark')
    expect(storage.data.get(THEME_KEY)).toBe('dark')

    const again = createThemeStore(storage)
    await again.getState().load()
    expect(again.getState().preference).toBe('dark')
  })

  it('une valeur stockée inconnue redonne « système »', async () => {
    const storage = memory()
    storage.data.set(THEME_KEY, 'sepia')
    const store = createThemeStore(storage)
    await store.getState().load()
    expect(store.getState().preference).toBe('system')
  })
})
