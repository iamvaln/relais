// La transmission ouverte : ContactStore (même base SQLCipher que le coffre)
// et service Transmission, tant que le KeyStore est déverrouillé.

import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { type Contact, ContactStore, Transmission, type TransmissionConfig } from '@relais/app-core'
import { api } from '@/lib/api'
import { keyStore } from './keystore'
import { sessionStore } from './session'
import { openVault } from './vault'

interface OpenTransmission {
  tx: Transmission
  store: ContactStore
}

interface TransmissionState {
  open: OpenTransmission | null
  config: TransmissionConfig | null
  contacts: Contact[]
  /** Incrémenté à chaque rafraîchissement : les écrans relisent. */
  version: number
}

export const transmissionStore = createStore<TransmissionState>(() => ({ open: null, config: null, contacts: [], version: 0 }))

let opening: Promise<OpenTransmission> | null = null

export async function openTransmission(): Promise<OpenTransmission> {
  const current = transmissionStore.getState().open
  if (current) return current
  opening ??= (async () => {
    const { db } = await openVault()
    const keys = () => {
      const k = keyStore.getState().keys
      if (!k) throw new Error('coffre verrouillé')
      return k
    }
    const signer = () => {
      const s = keyStore.getState().signer
      if (!s) throw new Error('coffre verrouillé')
      return s
    }
    const store = new ContactStore(db, keys)
    await store.init()
    const tx = new Transmission({
      api,
      store,
      keys,
      signer,
      // D.2 : le prénom que le contact verra dans l'email de désignation.
      ownerDisplayName: () => sessionStore.getState().user?.full_name?.trim().split(/\s+/)[0],
    })
    const open = { tx, store }
    transmissionStore.setState({ open })
    return open
  })().finally(() => {
    opening = null
  })
  return opening
}

/** Relit l'état serveur et les contacts locaux ; les écrans s'abonnent à `version`. */
export async function refreshTransmission(): Promise<{ config: TransmissionConfig; contacts: Contact[] }> {
  const { tx, store } = await openTransmission()
  const [config, contacts] = await Promise.all([tx.config(), store.list()])
  transmissionStore.setState((s) => ({ config, contacts, version: s.version + 1 }))
  return { config, contacts }
}

// Verrouillage du KeyStore → tout est oublié (la base se ferme avec le coffre).
keyStore.subscribe((s, prev) => {
  if (prev.status === 'unlocked' && s.status === 'locked') transmissionStore.setState({ open: null, config: null, contacts: [] })
})

export function useTransmission(): Pick<TransmissionState, 'config' | 'contacts' | 'version'> {
  return useStore(
    transmissionStore,
    useShallow((s) => ({ config: s.config, contacts: s.contacts, version: s.version })),
  )
}
