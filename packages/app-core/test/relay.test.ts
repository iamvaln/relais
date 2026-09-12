// Côté contact, sans réseau : la checklist par urgence (E5-US04) et la
// progression « Fait » gardée localement, qui expire avec l'accès.

import { describe, expect, it } from 'vitest'
import { MemorySecureStorage } from '../src/secure-storage.js'
import { checklist, phaseOf, RelayProgress, type RelayLinkView, type RelayStatusView } from '../src/relay/index.js'
import type { VaultItem } from '../src/vault/types.js'

const item = (id: string, urgency: VaultItem['urgency'], category: VaultItem['category'] = 'accounts'): VaultItem => ({
  id,
  category,
  service_name: id,
  urgency,
  created_at: 1,
  updated_at: 1,
})

describe('checklist', () => {
  it('trois sections, dans l’ordre Immédiat / Sous 30 jours / À votre discrétion, toutes catégories confondues', () => {
    const c = checklist({ accounts: [item('a', 'discretion'), item('b', 'immediate')], finances: [item('c', 'within_30_days', 'finances'), item('d', 'immediate', 'finances')] })
    expect(c.map((s) => [s.urgency, s.items.map((i) => i.id)])).toEqual([
      ['immediate', ['b', 'd']],
      ['within_30_days', ['c']],
      ['discretion', ['a']],
    ])
  })
})

describe('RelayProgress', () => {
  it('garde les tâches faites par lien, sans écrire le token en clair, et oublie tout après l’expiration', async () => {
    const storage = new MemorySecureStorage()
    let now = Date.parse('2026-09-12T10:00:00Z')
    const p = new RelayProgress(storage, () => now)
    const token = 'tok_secret_0123456789'
    const expires = '2026-10-15T00:00:00.000Z'
    expect(await p.done(token)).toEqual([])
    await p.mark(token, 'a', true, expires)
    await p.mark(token, 'b', true, expires)
    await p.mark(token, 'a', false, expires)
    expect(await p.done(token)).toEqual(['b'])
    for (const key of storage.keys()) expect(key.includes('tok_secret')).toBe(false)
    for (const value of storage.values()) expect(value.includes('tok_secret')).toBe(false)

    now = Date.parse('2026-10-16T00:00:00Z')
    expect(await p.done(token)).toEqual([])
    expect(storage.keys()).toHaveLength(0)
  })
})

describe('phaseOf', () => {
  const link = (contact_status: string, roles = { k1: true, k2: false, k3: false }): RelayLinkView =>
    ({ contact_status, roles, status: 'in_progress' }) as RelayLinkView
  const status = (unlocked: Record<'k1' | 'k2' | 'k3', boolean>): RelayStatusView => ({ unlocked }) as RelayStatusView

  it('questions → attente → accès → terminé, selon le contact et ce qui est déverrouillé pour ses rôles', () => {
    expect(phaseOf(link('notified'), status({ k1: false, k2: false, k3: false }))).toBe('questions')
    expect(phaseOf(link('answered'), status({ k1: false, k2: false, k3: false }))).toBe('waiting')
    // une catégorie déverrouillée qui n'est pas la sienne ne suffit pas
    expect(phaseOf(link('answered'), status({ k1: false, k2: true, k3: false }))).toBe('waiting')
    expect(phaseOf(link('answered'), status({ k1: true, k2: false, k3: false }))).toBe('access')
    expect(phaseOf(link('confirmed'), status({ k1: true, k2: false, k3: false }))).toBe('done')
  })
})
