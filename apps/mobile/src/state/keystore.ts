// KeyStore (Frontend §2.1, Techniques §5.4) — les clés en mémoire vive.
//
// Déverrouillé : K1/K2/K3 et la paire Ed25519, dérivées du seed (lui-même
// sorti de seed_enc_pin par le PIN ou la biométrie). Verrouillé : rien.
// Le seed reçu est effacé après dérivation ; lock() met les clés à zéro
// avant de les lâcher. Auto-verrouillage après 10 min sans activité
// (checkAutoLock est appelé par l'app au retour au premier plan et par un
// minuteur). Zustand « vanilla » : aucun import React Native, testable sous Node.

import { createStore, type StoreApi } from 'zustand/vanilla'
import { type CategoryKeys, type SigningKeypair, deriveCategoryKeys, deriveSigningKeypair, wipe } from '@relais/crypto-core'

export const AUTO_LOCK_MS = 10 * 60 * 1000

export interface KeyStoreState {
  status: 'locked' | 'unlocked'
  keys: CategoryKeys | null
  signer: SigningKeypair | null
  lastActivity: number
  unlockWithSeed(seed: Uint8Array): Promise<void>
  lock(): void
  touch(): void
  checkAutoLock(): void
}

export type KeyStore = StoreApi<KeyStoreState>

export function createKeyStore(deps: { now: () => number } = { now: Date.now }): KeyStore {
  return createStore<KeyStoreState>((set, get) => ({
    status: 'locked',
    keys: null,
    signer: null,
    lastActivity: 0,

    async unlockWithSeed(seed) {
      try {
        const keys = await deriveCategoryKeys(seed)
        const signer = await deriveSigningKeypair(seed)
        get().lock()
        set({ status: 'unlocked', keys, signer, lastActivity: deps.now() })
      } finally {
        wipe(seed)
      }
    },

    lock() {
      const { keys, signer } = get()
      if (keys) wipe(keys.k1, keys.k2, keys.k3)
      if (signer) wipe(signer.privateKey)
      set({ status: 'locked', keys: null, signer: null })
    },

    touch() {
      if (get().status === 'unlocked') set({ lastActivity: deps.now() })
    },

    checkAutoLock() {
      const { status, lastActivity } = get()
      if (status === 'unlocked' && deps.now() - lastActivity >= AUTO_LOCK_MS) get().lock()
    },
  }))
}

/** Instance de l'app. Les tests créent la leur avec createKeyStore. */
export const keyStore = createKeyStore()
