// Préférence d'apparence, persistée sur le device (pas un secret : le stockage
// sécurisé est simplement ce que l'app a déjà sous la main). Zustand « vanilla »,
// sans React Native, testé sous Node.

import { createStore, type StoreApi } from 'zustand/vanilla'
import { parsePreference, type ThemePreference } from '../lib/theme'

export const THEME_KEY = 'relais.theme'

export interface ThemeStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export interface ThemeState {
  preference: ThemePreference
  /** relit la préférence stockée ; à appeler une fois au lancement */
  load(): Promise<void>
  setPreference(preference: ThemePreference): Promise<void>
}

export type ThemeStore = StoreApi<ThemeState>

export function createThemeStore(storage: ThemeStorage): ThemeStore {
  return createStore<ThemeState>((set) => ({
    preference: 'system',
    async load() {
      set({ preference: parsePreference(await storage.get(THEME_KEY)) })
    },
    async setPreference(preference) {
      set({ preference })
      await storage.set(THEME_KEY, preference)
    },
  }))
}
