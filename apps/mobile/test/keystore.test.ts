// KeyStore (Frontend §2.1) : K1/K2/K3 et la clé de signature vivent en mémoire
// le temps d'une session déverrouillée ; verrouillage manuel ou après 10 min
// d'inactivité → tout est effacé. Aucune dépendance React Native : testé sous Node.

import { describe, expect, it } from 'vitest'
import { mnemonicToSeed } from '@relais/crypto-core'
import { AUTO_LOCK_MS, createKeyStore } from '../src/state/keystore'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('KeyStore', () => {
  it('démarre verrouillé ; unlockWithSeed dérive les clés et efface le seed reçu ; lock efface les clés', async () => {
    let now = 1_000_000
    const store = createKeyStore({ now: () => now })
    expect(store.getState().status).toBe('locked')
    expect(store.getState().keys).toBeNull()

    const seed = mnemonicToSeed(VECTOR)
    await store.getState().unlockWithSeed(seed)
    expect(seed.every((b) => b === 0)).toBe(true)
    const s = store.getState()
    expect(s.status).toBe('unlocked')
    expect(s.keys?.k1).toHaveLength(32)
    expect(s.signer?.publicKey).toHaveLength(32)
    // Clé du fichier SQLite (SQLCipher), dérivée du seed elle aussi — décision du 11/09/2026
    expect(s.dbKey).toHaveLength(32)
    expect(Buffer.from(s.dbKey!)).not.toEqual(Buffer.from(s.keys!.k1))
    const k1 = s.keys!.k1
    const sk = s.signer!.privateKey
    const dbKey = s.dbKey!

    now += 1000
    store.getState().lock()
    expect(store.getState().status).toBe('locked')
    expect(store.getState().keys).toBeNull()
    expect(store.getState().signer).toBeNull()
    expect(k1.every((b) => b === 0)).toBe(true)
    expect(sk.every((b) => b === 0)).toBe(true)
    expect(dbKey.every((b) => b === 0)).toBe(true)
    expect(store.getState().dbKey).toBeNull()
  })

  it('se verrouille seul après 10 minutes sans activité, pas avant ; touch() repousse l’échéance', async () => {
    let now = 0
    const store = createKeyStore({ now: () => now })
    await store.getState().unlockWithSeed(mnemonicToSeed(VECTOR))
    now = AUTO_LOCK_MS - 1
    store.getState().checkAutoLock()
    expect(store.getState().status).toBe('unlocked')
    store.getState().touch()
    now = AUTO_LOCK_MS + 5
    store.getState().checkAutoLock()
    expect(store.getState().status).toBe('unlocked')
    now = 2 * AUTO_LOCK_MS + 10
    store.getState().checkAutoLock()
    expect(store.getState().status).toBe('locked')
  })
})
