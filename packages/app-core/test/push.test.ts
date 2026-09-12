// L'identifiant OneSignal de l'utilisateur est un hachage, jamais l'identifiant lui-même (docs/mobile.md §3).
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { pushExternalId } from '../src/push.js'

describe('pushExternalId', () => {
  it('SHA256(user_id) en hex, le même que côté API', async () => {
    const id = '3f2c1a4e-0000-4000-8000-000000000001'
    const ext = await pushExternalId(id)
    expect(ext).toBe(createHash('sha256').update(id).digest('hex'))
    expect(ext).toHaveLength(64)
    expect(ext).not.toContain('3f2c1a4e')
  })
})
