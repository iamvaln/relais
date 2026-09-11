// seed_enc_pin (DEC-01 à DEC-04, Frontend §2.2) : le seed chiffré par une clé
// dérivée du PIN (Argon2id MODERATE, sel aléatoire stocké à côté). Permanent
// dans expo-secure-store ; le cœur ne fait que produire et ouvrir le blob.

import { describe, expect, it } from 'vitest'
import { mnemonicToSeed } from '../src/seed.js'
import { lockSeedWithPin, unlockSeedWithPin } from '../src/pin.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('seed_enc_pin', () => {
  it('verrouille avec un PIN, rouvre avec le même, refuse un autre', async () => {
    const seed = mnemonicToSeed(VECTOR)
    const locked = await lockSeedWithPin(seed, '482913')
    expect(locked.salt).toHaveLength(16)
    expect(locked.seed_enc_pin.length).toBeGreaterThan(64)
    expect(Buffer.from(locked.seed_enc_pin).includes(Buffer.from(seed))).toBe(false)
    const back = await unlockSeedWithPin(locked, '482913')
    expect(Buffer.from(back)).toEqual(Buffer.from(mnemonicToSeed(VECTOR)))
    await expect(unlockSeedWithPin(locked, '482914')).rejects.toThrow(/PIN/)
  })

  it('même PIN, sel différent : blobs différents ; le seed d’entrée est effacé après verrouillage', async () => {
    const seed = mnemonicToSeed(VECTOR)
    const a = await lockSeedWithPin(mnemonicToSeed(VECTOR), '000000')
    const b = await lockSeedWithPin(mnemonicToSeed(VECTOR), '000000')
    expect(Buffer.from(a.salt)).not.toEqual(Buffer.from(b.salt))
    expect(Buffer.from(a.seed_enc_pin)).not.toEqual(Buffer.from(b.seed_enc_pin))
    await lockSeedWithPin(seed, '000000')
    expect(seed.every((x) => x === 0)).toBe(true)
  })
})
