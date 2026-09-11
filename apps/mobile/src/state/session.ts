// Session de l'app : qui est connecté, où en est l'onboarding. L'access
// token vit dans le client API ; le refresh token dans les cookies natifs.

import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PublicUser } from '@relais/api-client'
import { Onboarding } from '@relais/app-core'
import { api } from '@/lib/api'
import { device } from '@/lib/device'
import type { Language } from '@/i18n'
import { keyStore } from './keystore'
import type { SessionStatus } from './routing'

export interface SessionState {
  status: SessionStatus
  user: PublicUser | null
  language: Language
  onboarding: Onboarding | null
  startOnboarding(): Onboarding
  setUser(user: PublicUser): void
  signOut(): Promise<void>
}

export const sessionStore = createStore<SessionState>((set, get) => ({
  status: 'anonymous',
  user: null,
  language: 'fr',
  onboarding: null,

  startOnboarding() {
    const flow = new Onboarding({ api, device, language: get().language })
    set({ status: 'onboarding', onboarding: flow })
    return flow
  },

  setUser(user) {
    set({ status: 'authenticated', user, onboarding: null, language: user.language })
  },

  async signOut() {
    keyStore.getState().lock()
    await api.auth.logout().catch(() => undefined)
    set({ status: 'anonymous', user: null, onboarding: null })
  },
}))

export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(sessionStore, selector)
}
