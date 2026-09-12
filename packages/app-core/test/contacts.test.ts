// Contacts de confiance côté owner, sur le device (E3-US01 à US03, E2-US05).
// Ce que le serveur ne rend jamais en clair (nom, email, téléphone, message,
// réponses secrètes) vit ici : un blob par contact, seal(K2, JSON), dans la
// même base SQLite (SQLCipher sur le device). Rôles, questions et position
// restent en colonnes : le serveur les connaît déjà. Décision du 12/09/2026 :
// les réponses restent sur le device, chiffrées, jamais synchronisées.

import { describe, expect, it } from 'vitest'
import { deriveCategoryKeys, mnemonicToSeed } from '@relais/crypto-core'
import { ContactStore } from '../src/transmission/index.js'
import { NodeSqlite } from './sqlite-node.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const Q: [string, string, string] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']

async function makeStore(db = new NodeSqlite()) {
  const keys = await deriveCategoryKeys(mnemonicToSeed(VECTOR))
  let now = 1_700_000_000_000
  let n = 0
  const store = new ContactStore(db, () => keys, { now: () => now, id: () => `local-${++n}` })
  await store.init()
  return { store, db, tick: (ms: number) => (now += ms) }
}

const herve = {
  name: 'Hervé Ngo',
  email: 'herve@example.cm',
  phone: '+237699000000',
  message: 'Merci pour tout, petit frère.',
  roles: { k1: true, k2: false, k3: true },
  questionIds: Q,
  answers: ['Yaoundé', 'Rex', '1990'] as [string, string, string],
}

describe('ContactStore', () => {
  it('ajoute, relit, modifie, retire ; ni nom, ni email, ni réponses, ni message lisibles dans la base', async () => {
    const { store, db, tick } = await makeStore()
    const c = await store.add(herve)
    expect(c).toEqual({ id: 'local-1', serverId: null, position: 1, created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, ...herve })
    expect(await store.get('local-1')).toEqual(c)

    const rows = db.raw<{ id: string; server_id: string | null; roles: string; question_ids: string; payload: Uint8Array }>('select id, server_id, roles, question_ids, payload from contacts')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'local-1', server_id: null, roles: 'k1,k3', question_ids: Q.join(',') })
    const onDisk = Buffer.from(rows[0]!.payload)
    for (const clear of ['Hervé', 'herve@', '699000000', 'Yaound', 'Rex', '1990', 'petit frère']) expect(onDisk.includes(Buffer.from(clear))).toBe(false)

    tick(60_000)
    const updated = await store.update('local-1', { serverId: 'srv-1', roles: { k1: true, k2: true, k3: false }, answers: null, message: '' })
    expect(updated).toMatchObject({ serverId: 'srv-1', roles: { k1: true, k2: true, k3: false }, answers: null, message: '', email: 'herve@example.cm', updated_at: 1_700_000_060_000 })
    expect(await store.get('local-1')).toEqual(updated)

    await store.remove('local-1')
    expect(await store.get('local-1')).toBeNull()
    await expect(store.update('local-1', { name: 'x' })).rejects.toThrow(/introuvable/)
  })

  it('liste dans l’ordre des positions, retrouve un contact par son identifiant serveur, remplace tout à la restauration', async () => {
    const { store } = await makeStore()
    await store.add(herve)
    await store.add({ ...herve, name: 'Adjoua', email: 'adjoua@example.cm', roles: { k1: true, k2: true, k3: false } })
    expect((await store.list()).map((c) => [c.id, c.position, c.name])).toEqual([
      ['local-1', 1, 'Hervé Ngo'],
      ['local-2', 2, 'Adjoua'],
    ])
    await store.update('local-2', { serverId: 'srv-2' })
    expect((await store.byServerId('srv-2'))?.id).toBe('local-2')
    expect(await store.byServerId('srv-9')).toBeNull()

    // Un contact retiré libère sa position ; le suivant prend la position libre suivante
    await store.remove('local-1')
    const third = await store.add({ ...herve, name: 'Paul' })
    expect(third.position).toBe(3)

    await store.replaceAll([
      { ...herve, name: 'Restauré 1', serverId: 'srv-a', answers: null, position: 1 },
      { ...herve, name: 'Restauré 2', serverId: 'srv-b', answers: null, position: 2 },
    ])
    expect((await store.list()).map((c) => [c.name, c.serverId, c.answers, c.position])).toEqual([
      ['Restauré 1', 'srv-a', null, 1],
      ['Restauré 2', 'srv-b', null, 2],
    ])
  })

  it('refuse un contact sans nom ou sans email, et un téléphone vide devient null', async () => {
    const { store } = await makeStore()
    await expect(store.add({ ...herve, name: '  ' })).rejects.toThrow(/nom/)
    await expect(store.add({ ...herve, email: 'pas-un-email' })).rejects.toThrow(/email/)
    const c = await store.add({ ...herve, phone: '  ' })
    expect(c.phone).toBeNull()
  })
})
