// Synchronisation du coffre (E2-US01/03/04, Techniques §5.2 « debounced 3s ») :
// une modification marque la catégorie ; 3 s sans autre modification → un
// seul envoi de P2 = seal(Ki, JSON(lignes)) signé. Ici le transport est en
// mémoire pour tester le rythme ; le vrai transport HTTP est prouvé contre
// l'API dans apps/api/test/app-core-vault.test.ts.

import { describe, expect, it } from 'vitest'
import { deriveCategoryKeys, deriveSigningKeypair, mnemonicToSeed, open, verifyPayload } from '@relais/crypto-core'
import { LocalVault, VaultSync, type SyncPayload, type VaultCategory, type VaultTransport } from '../src/vault/index.js'
import { NodeSqlite } from './sqlite-node.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

class MemoryTransport implements VaultTransport {
  sent: SyncPayload[] = []
  stored = new Map<VaultCategory, string>()
  async sync(body: SyncPayload): Promise<void> {
    this.sent.push(body)
    this.stored.set(body.category, body.payload)
  }
  async restore(category: VaultCategory): Promise<{ payload: string } | null> {
    const p = this.stored.get(category)
    return p ? { payload: p } : null
  }
}

class FakeClock {
  private timers: { at: number; fn: () => void }[] = []
  now = 0
  schedule = (fn: () => void, ms: number) => {
    const t = { at: this.now + ms, fn }
    this.timers.push(t)
    return () => {
      this.timers = this.timers.filter((x) => x !== t)
    }
  }
  async advance(ms: number): Promise<void> {
    this.now += ms
    const due = this.timers.filter((t) => t.at <= this.now).sort((a, b) => a.at - b.at)
    this.timers = this.timers.filter((t) => t.at > this.now)
    for (const t of due) t.fn()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  }
}

async function setup() {
  const seed = mnemonicToSeed(VECTOR)
  const keys = await deriveCategoryKeys(seed)
  const signer = await deriveSigningKeypair(seed)
  const clock = new FakeClock()
  const transport = new MemoryTransport()
  let n = 0
  const sync = new VaultSync({ transport, keys: () => keys, signer: () => signer, schedule: clock.schedule, debounceMs: 3000 })
  const vault = new LocalVault(new NodeSqlite(), () => keys, { id: () => `id-${++n}`, onChange: (c) => sync.markDirty(c) })
  await vault.init()
  sync.attach(vault)
  return { keys, signer, clock, transport, sync, vault }
}

describe('VaultSync', () => {
  it('regroupe les modifications d’une catégorie : un envoi 3 s après la dernière, par catégorie touchée', async () => {
    const { clock, transport, vault, keys, signer } = await setup()
    await vault.add({ category: 'accounts', service_name: 'Orange Money', password: 'x', urgency: 'immediate' })
    await clock.advance(2000)
    await vault.add({ category: 'accounts', service_name: 'Gmail', urgency: 'discretion' })
    await vault.add({ category: 'finances', service_name: 'Ecobank', urgency: 'discretion' })
    expect(transport.sent).toHaveLength(0)
    await clock.advance(2999)
    expect(transport.sent).toHaveLength(0)
    await clock.advance(1)
    expect(transport.sent.map((s) => s.category).sort()).toEqual(['accounts', 'finances'])

    // P2 signé, opaque, et il contient bien les deux lignes accounts
    const accounts = transport.sent.find((s) => s.category === 'accounts')!
    const p2 = new Uint8Array(Buffer.from(accounts.payload, 'base64'))
    expect(await verifyPayload(p2, new Uint8Array(Buffer.from(accounts.signature, 'base64')), signer.publicKey)).toBe(true)
    expect(accounts.payload.includes('Orange')).toBe(false)
    const rows = JSON.parse(Buffer.from(await open(keys.k1, p2)).toString('utf8')) as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual(['id-1', 'id-2'])
    expect(JSON.stringify(rows)).not.toContain('Orange')
  })

  it('flushAll envoie tout de suite ce qui est en attente ; une suppression synchronise aussi ; restore remplace la catégorie', async () => {
    const { clock, transport, vault, sync, keys } = await setup()
    await vault.add({ category: 'messages', service_name: 'Pour maman', instructions: 'Lis ceci', urgency: 'discretion' })
    await sync.flushAll()
    expect(transport.sent.map((s) => s.category)).toEqual(['messages'])
    await clock.advance(5000)
    expect(transport.sent).toHaveLength(1)

    await vault.remove('id-1')
    await clock.advance(3000)
    expect(transport.sent).toHaveLength(2)
    expect(JSON.parse(Buffer.from(await open(keys.k2, new Uint8Array(Buffer.from(transport.sent[1]!.payload, 'base64')))).toString('utf8'))).toEqual([])

    // Un autre device restaure depuis le backup du premier envoi
    transport.stored.set('messages', transport.sent[0]!.payload)
    const other = new LocalVault(new NodeSqlite(), () => keys)
    await other.init()
    const otherSync = new VaultSync({ transport, keys: () => keys, signer: () => (undefined as never), schedule: clock.schedule })
    otherSync.attach(other)
    expect(await otherSync.restore('messages')).toEqual({ restored: 1 })
    expect((await other.list()).map((i) => [i.service_name, i.instructions])).toEqual([['Pour maman', 'Lis ceci']])
    expect(await otherSync.restore('finances')).toEqual({ restored: 0 })
  })
})
