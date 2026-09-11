// Le coffre ouvert : LocalVault + VaultSync sur la base SQLCipher, tant que le
// KeyStore est déverrouillé. Verrouillage → fermeture et oubli.

import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { ApiVaultTransport, LocalVault, VaultSync, type VaultCategory } from '@relais/app-core'
import { api } from '@/lib/api'
import { type ExpoVaultDatabase, openVaultDatabase } from '@/lib/vault-db'
import { keyStore } from './keystore'

interface OpenVault {
  vault: LocalVault
  sync: VaultSync
  db: ExpoVaultDatabase
}

interface VaultState {
  open: OpenVault | null
  /** Incrémenté à chaque modification : les écrans relisent. */
  version: number
  syncError: VaultCategory | null
}

export const vaultStore = createStore<VaultState>(() => ({ open: null, version: 0, syncError: null }))

let opening: Promise<OpenVault> | null = null

export async function openVault(): Promise<OpenVault> {
  const current = vaultStore.getState().open
  if (current) return current
  opening ??= (async () => {
    const ks = keyStore.getState()
    if (ks.status !== 'unlocked' || !ks.dbKey || !ks.keys || !ks.signer) throw new Error('coffre verrouillé')
    const db = await openVaultDatabase(ks.dbKey)
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
    const sync = new VaultSync({
      transport: new ApiVaultTransport(api),
      keys,
      signer,
      onError: (category) => vaultStore.setState({ syncError: category }),
    })
    const vault = new LocalVault(db, keys, {
      onChange: (c) => {
        sync.markDirty(c)
        vaultStore.setState((s) => ({ version: s.version + 1, syncError: null }))
      },
    })
    await vault.init()
    sync.attach(vault)
    const open = { vault, sync, db }
    vaultStore.setState({ open })
    return open
  })().finally(() => {
    opening = null
  })
  return opening
}

export async function closeVault(): Promise<void> {
  const open = vaultStore.getState().open
  if (!open) return
  vaultStore.setState({ open: null })
  await open.sync.flushAll().catch(() => undefined)
  await open.db.close().catch(() => undefined)
}

// Verrouillage du KeyStore → le coffre se ferme.
keyStore.subscribe((s, prev) => {
  if (prev.status === 'unlocked' && s.status === 'locked') void closeVault()
})

export function useVaultVersion(): number {
  return useStore(vaultStore, (s) => s.version)
}

export function useSyncError(): VaultCategory | null {
  return useStore(vaultStore, (s) => s.syncError)
}
