// Le device (DEC-01 à DEC-04, E1-US03, Frontend §2.1-2.2) : seed_enc_pin
// permanent, biométrie par clé gardée avec authentification requise
// (décision du 11/09/2026), compteur d'échecs PIN, effacement.

import { describe, expect, it } from 'vitest'
import { mnemonicToSeed } from '@relais/crypto-core'
import { DeviceVault, PinInvalidError, PinLockedError, WeakPinError } from '../src/device.js'
import { PinGuard } from '../src/pin-policy.js'
import { BiometricRefusedError, MemorySecureStorage } from '../src/secure-storage.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const seedHex = () => Buffer.from(mnemonicToSeed(VECTOR)).toString('hex')

function makeDevice(now = () => 1_000_000) {
  const storage = new MemorySecureStorage()
  return { storage, device: new DeviceVault(storage, new PinGuard(storage, { now })) }
}

describe('PIN', () => {
  it('refuse un PIN faible ; sinon garde seed_enc_pin, rend le seed au bon PIN, jamais en clair dans le stockage', async () => {
    const { storage, device } = makeDevice()
    expect(await device.hasSeed()).toBe(false)
    await expect(device.setupPin(mnemonicToSeed(VECTOR), '123456')).rejects.toThrow(WeakPinError)
    expect(await device.hasSeed()).toBe(false)

    const seed = mnemonicToSeed(VECTOR)
    await device.setupPin(seed, '482913')
    expect(Buffer.from(seed).toString('hex')).toBe(seedHex()) // le seed de l'appelant est intact
    expect(await device.hasSeed()).toBe(true)
    for (const k of storage.keys()) expect((await storage.get(k))!.includes(seedHex())).toBe(false)

    const back = await device.unlockWithPin('482913')
    expect(Buffer.from(back).toString('hex')).toBe(seedHex())
  })

  it('mauvais PIN : compté ; au 5ᵉ, bloqué 30 s ; le bon PIN remet le compteur à zéro', async () => {
    let now = 1_000_000
    const { device } = makeDevice(() => now)
    await device.setupPin(mnemonicToSeed(VECTOR), '482913')
    for (let i = 1; i <= 4; i++) {
      const err = await device.unlockWithPin('000001').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PinInvalidError)
      expect(err).toMatchObject({ failCount: i, retryInSeconds: 0 })
    }
    const fifth = await device.unlockWithPin('000001').catch((e: unknown) => e)
    expect(fifth).toBeInstanceOf(PinInvalidError)
    expect(fifth).toMatchObject({ failCount: 5, retryInSeconds: 30 })
    const locked = await device.unlockWithPin('482913').catch((e: unknown) => e)
    expect(locked).toBeInstanceOf(PinLockedError)
    expect(locked).toMatchObject({ retryInSeconds: 30 })
    now += 31_000
    expect(await device.unlockWithPin('482913')).toHaveLength(64)
    const err = await device.unlockWithPin('000001').catch((e: unknown) => e)
    expect(err).toMatchObject({ failCount: 1 })
  })

  it('changer de PIN : ancien exigé, nouveau vérifié, l’ancien ne marche plus', async () => {
    const { device } = makeDevice()
    await device.setupPin(mnemonicToSeed(VECTOR), '482913')
    await expect(device.changePin('482913', '111111')).rejects.toThrow(WeakPinError)
    await expect(device.changePin('000000', '907315')).rejects.toThrow(PinInvalidError)
    await device.changePin('482913', '907315')
    expect(await device.unlockWithPin('907315')).toHaveLength(64)
    await expect(device.unlockWithPin('482913')).rejects.toThrow(PinInvalidError)
  })
})

describe('biométrie', () => {
  it('active : une clé gardée avec authentification requise ouvre seed_enc_bio ; refus biométrique → erreur ; désactivation', async () => {
    const { storage, device } = makeDevice()
    await device.setupPin(mnemonicToSeed(VECTOR), '482913')
    expect(await device.hasBiometrics()).toBe(false)
    await device.enableBiometrics(mnemonicToSeed(VECTOR))
    expect(await device.hasBiometrics()).toBe(true)
    expect(Buffer.from(await device.unlockWithBiometrics()).toString('hex')).toBe(seedHex())

    storage.biometricGate = async () => false
    await expect(device.unlockWithBiometrics()).rejects.toThrow(BiometricRefusedError)
    storage.biometricGate = async () => true

    await device.disableBiometrics()
    expect(await device.hasBiometrics()).toBe(false)
    await expect(device.unlockWithBiometrics()).rejects.toThrow(/biométrie/i)
    expect(await device.unlockWithPin('482913')).toHaveLength(64) // le PIN reste
  })

  it('wipe efface tout : plus de seed, plus de biométrie, compteur à zéro', async () => {
    const { storage, device } = makeDevice()
    await device.setupPin(mnemonicToSeed(VECTOR), '482913')
    await device.enableBiometrics(mnemonicToSeed(VECTOR))
    await device.unlockWithPin('000001').catch(() => undefined)
    await device.wipe()
    expect(await device.hasSeed()).toBe(false)
    expect(await device.hasBiometrics()).toBe(false)
    expect(storage.keys()).toEqual([])
  })
})
