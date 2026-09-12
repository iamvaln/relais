// Coffre de l'app contre la vraie API : sync par catégorie après modification,
// statut, restauration sur un nouveau device. Le serveur ne reçoit que P2.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiClient, MemoryCookieJar } from '@relais/api-client'
import { ApiVaultTransport, DeviceVault, LocalVault, MemorySecureStorage, Onboarding, PinGuard, VaultSync, proveSeed } from '@relais/app-core'
import { deriveCategoryKeys, deriveSigningKeypair } from '@relais/crypto-core'
import { NodeSqlite } from '../../../packages/app-core/test/sqlite-node.js'
import { vaultKey } from '../src/api/vault/service.js'
import { objectStore } from '../src/services/storage/index.js'
import { closeAll, getApp, lastOtp, resetState, STRONG_PASSWORD } from './helpers.js'

let baseUrl = ''
beforeAll(async () => {
  baseUrl = await (await getApp()).listen({ port: 0, host: '127.0.0.1' })
})
beforeEach(resetState)
afterAll(closeAll)

async function onboardedDevice() {
  const storage = new MemorySecureStorage()
  const api = new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' })
  const device = new DeviceVault(storage, new PinGuard(storage))
  const flow = new Onboarding({ api, device, language: 'fr', random: () => 0.5 })
  await flow.submitAccount({ full_name: 'Adjoua Ngo', email: 'adjoua@example.cm', phone: '+237699000000', password: STRONG_PASSWORD, language: 'fr' })
  await flow.submitOtp(lastOtp())
  const words = flow.state.words!
  const [a, b] = flow.confirmWordsNoted()
  flow.checkQuiz([words.split(' ')[a]!, words.split(' ')[b]!])
  const { seed } = await flow.submitPin('482913')
  flow.finish()
  const keys = await deriveCategoryKeys(seed)
  const signer = await deriveSigningKeypair(seed)
  return { api, keys, signer, words, userId: (await api.auth.me()).id }
}

describe('coffre ↔ API', () => {
  it('sync après modification, statut par catégorie, restauration sur un nouveau device ; P2 opaque sur le serveur', async () => {
    const d = await onboardedDevice()
    const sync = new VaultSync({ transport: new ApiVaultTransport(d.api), keys: () => d.keys, signer: () => d.signer, debounceMs: 0 })
    let n = 0
    const vault = new LocalVault(new NodeSqlite(), () => d.keys, { id: () => `id-${++n}`, onChange: (c) => sync.markDirty(c) })
    await vault.init()
    sync.attach(vault)

    await vault.add({ category: 'accounts', service_name: 'Orange Money', login: '+237699000000', password: 'S3cret!', instructions: 'Appelle le 8008', urgency: 'immediate' })
    await vault.add({ category: 'finances', service_name: 'Ecobank', urgency: 'discretion' })
    await sync.flushAll()

    const status = await sync.status()
    expect(status.accounts).not.toBeNull()
    expect(status.finances).not.toBeNull()
    expect(status.messages).toBeNull()
    const stored = await objectStore().get(vaultKey(d.userId, 'accounts'))
    const blob = Buffer.from(stored!)
    for (const clear of ['Orange', 'S3cret', '8008', 'id-1']) expect(blob.includes(Buffer.from(clear))).toBe(false)

    // Nouveau device : mêmes clés (12 mots), coffre vide → restauration, une fois le seed prouvé (audit LOW-13)
    const other = new LocalVault(new NodeSqlite(), () => d.keys)
    await other.init()
    const otherSync = new VaultSync({ transport: new ApiVaultTransport(d.api), keys: () => d.keys, signer: () => d.signer })
    otherSync.attach(other)
    await expect(otherSync.restoreAll()).rejects.toMatchObject({ code: 'AUTH_RESTORE_REQUIRED' })
    await proveSeed(d.api, d.signer)
    expect(await otherSync.restoreAll()).toEqual({ accounts: 1, messages: 0, finances: 1 })
    expect((await other.list()).map((i) => [i.id, i.service_name, i.password ?? null])).toEqual([
      ['id-1', 'Orange Money', 'S3cret!'],
      ['id-2', 'Ecobank', null],
    ])
  })
})
