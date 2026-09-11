// PIN à 6 chiffres (E1-US03) et backoff progressif (DEC-26, Techniques §7.2,
// Frontend §3.5) : 5 tentatives libres, puis 30 s, 2 min, 10 min, 30 min.
// 100 % côté client ; le compteur survit au redémarrage (SecureStorage).

import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKOFF_STEPS, PinGuard, lockSeconds, weakPinReason } from '../src/pin-policy.js'
import { MemorySecureStorage } from '../src/secure-storage.js'

describe('weakPinReason', () => {
  it('refuse les formats et les séquences trop simples, accepte un PIN ordinaire', () => {
    expect(weakPinReason('12345')).toBe('format')
    expect(weakPinReason('12345a')).toBe('format')
    expect(weakPinReason('000000')).toBe('repeated')
    expect(weakPinReason('777777')).toBe('repeated')
    expect(weakPinReason('123456')).toBe('sequence')
    expect(weakPinReason('654321')).toBe('sequence')
    expect(weakPinReason('012345')).toBe('sequence')
    expect(weakPinReason('123123')).toBe('pattern')
    expect(weakPinReason('121212')).toBe('pattern')
    expect(weakPinReason('112233')).toBe('pattern')
    expect(weakPinReason('482913')).toBeNull()
    expect(weakPinReason('200517')).toBeNull()
  })
})

describe('lockSeconds', () => {
  it('libre jusqu’à 4 échecs, 30 s au 5ᵉ, puis 2 min, 10 min, 30 min plafonné', () => {
    expect([0, 1, 4].map((n) => lockSeconds(n))).toEqual([0, 0, 0])
    expect([5, 6, 7, 8, 20].map((n) => lockSeconds(n))).toEqual([30, 120, 600, 1800, 1800])
    expect(lockSeconds(5, [10, 20])).toBe(10)
    expect(lockSeconds(9, [10, 20])).toBe(20)
    expect(DEFAULT_BACKOFF_STEPS).toEqual([30, 120, 600, 1800])
  })
})

describe('PinGuard', () => {
  it('compte les échecs, bloque à partir du 5ᵉ, libère après le délai, se remet à zéro au succès ; l’état survit à une nouvelle instance', async () => {
    let now = 1_000_000
    const storage = new MemorySecureStorage()
    const guard = new PinGuard(storage, { now: () => now })
    expect(await guard.check()).toEqual({ allowed: true, failCount: 0, retryInSeconds: 0 })
    for (let i = 1; i <= 4; i++) await guard.recordFailure()
    expect(await guard.check()).toMatchObject({ allowed: true, failCount: 4 })
    await guard.recordFailure()
    expect(await guard.check()).toEqual({ allowed: false, failCount: 5, retryInSeconds: 30 })
    now += 29_000
    expect((await guard.check()).allowed).toBe(false)
    now += 2_000
    expect(await guard.check()).toMatchObject({ allowed: true, failCount: 5 })
    await guard.recordFailure()
    expect(await guard.check()).toEqual({ allowed: false, failCount: 6, retryInSeconds: 120 })

    const again = new PinGuard(storage, { now: () => now })
    expect(await again.check()).toMatchObject({ allowed: false, failCount: 6 })
    await again.reset()
    expect(await again.check()).toEqual({ allowed: true, failCount: 0, retryInSeconds: 0 })
  })
})
