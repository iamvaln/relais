// Coffre local (E2-US01 à US04, Techniques §5.2) : chaque fiche est un blob
// P1 = seal(Ki, JSON) dans SQLite ; catégorie, urgence et dates restent en
// colonnes (le fichier est lui-même sous SQLCipher sur le device). Lecture et
// filtres se font en mémoire, jamais sur le réseau.

import { describe, expect, it } from 'vitest'
import { deriveCategoryKeys, mnemonicToSeed } from '@relais/crypto-core'
import { LocalVault, type VaultCategory } from '../src/vault/index.js'
import { NodeSqlite } from './sqlite-node.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

async function makeVault(mnemonic = VECTOR, db = new NodeSqlite()) {
  const keys = await deriveCategoryKeys(mnemonicToSeed(mnemonic))
  let now = 1_700_000_000_000
  let n = 0
  const changes: VaultCategory[] = []
  const vault = new LocalVault(db, () => keys, { now: () => now, id: () => `id-${++n}`, onChange: (c) => changes.push(c) })
  await vault.init()
  return { vault, db, keys, changes, tick: (ms: number) => (now += ms) }
}

describe('LocalVault — fiches', () => {
  it('ajoute, relit, modifie, supprime ; rien de lisible dans la base', async () => {
    const { vault, db, changes, tick } = await makeVault()
    const item = await vault.add({ category: 'accounts', service_name: 'Orange Money', login: '+237699000000', password: 'S3cret!', instructions: 'Appelle le 8008', urgency: 'immediate' })
    expect(item).toMatchObject({ id: 'id-1', category: 'accounts', service_name: 'Orange Money', urgency: 'immediate', created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000 })
    expect(await vault.get('id-1')).toEqual(item)

    const rows = db.raw<{ id: string; category: string; urgency: string; payload: Uint8Array }>('select id, category, urgency, payload from vault_items')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'id-1', category: 'accounts', urgency: 'immediate' })
    const onDisk = Buffer.from(rows[0]!.payload)
    for (const clear of ['Orange', '699000000', 'S3cret', '8008']) expect(onDisk.includes(Buffer.from(clear))).toBe(false)

    tick(60_000)
    const updated = await vault.update('id-1', { password: 'N3w!', urgency: 'discretion' })
    expect(updated).toMatchObject({ password: 'N3w!', login: '+237699000000', urgency: 'discretion', created_at: 1_700_000_000_000, updated_at: 1_700_000_060_000 })
    await vault.remove('id-1')
    expect(await vault.get('id-1')).toBeNull()
    await expect(vault.update('id-1', { notes: 'x' })).rejects.toThrow(/introuvable/)
    expect(changes).toEqual(['accounts', 'accounts', 'accounts'])
  })

  it('liste, filtre par catégorie et urgence, cherche par nom sans casse ni accents, compte par catégorie', async () => {
    const { vault } = await makeVault()
    await vault.add({ category: 'accounts', service_name: 'Orange Money', urgency: 'immediate' })
    await vault.add({ category: 'accounts', service_name: 'Gmail', urgency: 'within_30_days' })
    await vault.add({ category: 'finances', service_name: 'Ecobank — épargne', urgency: 'discretion' })
    await vault.add({ category: 'messages', service_name: 'Pour maman', urgency: 'discretion' })
    expect((await vault.list()).map((i) => i.service_name)).toEqual(['Orange Money', 'Gmail', 'Ecobank — épargne', 'Pour maman'])
    expect((await vault.list({ category: 'accounts' })).map((i) => i.service_name)).toEqual(['Orange Money', 'Gmail'])
    expect((await vault.list({ urgency: 'discretion' })).map((i) => i.service_name)).toEqual(['Ecobank — épargne', 'Pour maman'])
    expect((await vault.list({ search: 'ECOBANK epargne' })).map((i) => i.service_name)).toEqual(['Ecobank — épargne'])
    expect((await vault.list({ category: 'accounts', search: 'mail' })).map((i) => i.service_name)).toEqual(['Gmail'])
    expect(await vault.counts()).toEqual({ accounts: 2, messages: 1, finances: 1 })
  })

  it('les clés d’un autre seed ne relisent rien', async () => {
    const db = new NodeSqlite()
    const { vault } = await makeVault(VECTOR, db)
    await vault.add({ category: 'accounts', service_name: 'Orange Money', urgency: 'immediate' })
    const { vault: intruder } = await makeVault(OTHER, db)
    await expect(intruder.list()).rejects.toThrow(/déchiffrement/)
  })

  it('export / import d’une catégorie : les lignes chiffrées voyagent telles quelles, puis se relisent ailleurs', async () => {
    const a = await makeVault()
    await a.vault.add({ category: 'accounts', service_name: 'Orange Money', password: 'x', urgency: 'immediate' })
    await a.vault.add({ category: 'finances', service_name: 'Ecobank', urgency: 'discretion' })
    const rows = await a.vault.exportCategory('accounts')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'id-1', urgency: 'immediate' })
    expect(typeof rows[0]!.payload).toBe('string')
    expect(JSON.stringify(rows)).not.toContain('Orange')

    const b = await makeVault()
    await b.vault.add({ category: 'accounts', service_name: 'À remplacer', urgency: 'discretion' })
    await b.vault.importCategory('accounts', rows)
    expect((await b.vault.list({ category: 'accounts' })).map((i) => [i.id, i.service_name, i.password])).toEqual([['id-1', 'Orange Money', 'x']])
    expect(await b.vault.counts()).toEqual({ accounts: 1, messages: 0, finances: 0 })
  })
})
