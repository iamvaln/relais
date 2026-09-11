// Le device de l'owner (DEC-01 à DEC-04, E1-US03, Frontend §2.1-2.2).
//
//   seed_enc_pin  = seal(Argon2id(PIN, sel), seed)   — permanent, jamais supprimé (DEC-01)
//   seed_enc_bio  = seal(K_bio, seed)                — K_bio : 32 octets aléatoires gardés par le
//                   Keychain / Keystore avec authentification requise (Face ID, empreinte) ;
//                   décision du 11/09/2026. Le PIN reste le secours.
//
// Les mauvais PIN passent par PinGuard (DEC-26). Le seed n'est jamais écrit
// en clair ; les copies en mémoire sont effacées après usage.

import { lockSeedWithPin, open, randomBytes, seal, unlockSeedWithPin, wipe } from '@relais/crypto-core'
import { type PinGuardStatus, PinGuard, weakPinReason, type WeakPinReason } from './pin-policy.js'
import type { SecureStorage } from './secure-storage.js'

const KEY_SEED_PIN = 'relais.seed_enc_pin'
const KEY_SEED_BIO = 'relais.seed_enc_bio'
const KEY_BIO = 'relais.bio_key'

export class WeakPinError extends Error {
  constructor(readonly reason: WeakPinReason) {
    super(`PIN trop simple (${reason})`)
    this.name = 'WeakPinError'
  }
}

export class PinInvalidError extends Error {
  readonly failCount: number
  readonly retryInSeconds: number
  constructor(status: PinGuardStatus) {
    super('PIN incorrect')
    this.name = 'PinInvalidError'
    this.failCount = status.failCount
    this.retryInSeconds = status.retryInSeconds
  }
}

export class PinLockedError extends Error {
  constructor(readonly retryInSeconds: number) {
    super(`Trop d'essais : réessayez dans ${retryInSeconds} s`)
    this.name = 'PinLockedError'
  }
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

interface StoredPinSeed {
  seed_enc_pin: string
  salt: string
}

export class DeviceVault {
  constructor(
    private readonly storage: SecureStorage,
    private readonly guard: PinGuard,
    private readonly biometricPrompt = 'Déverrouiller Relais',
  ) {}

  async hasSeed(): Promise<boolean> {
    return (await this.storage.get(KEY_SEED_PIN)) !== null
  }

  /** Chiffre une copie du seed avec le PIN ; le seed de l'appelant reste intact. */
  async setupPin(seed: Uint8Array, pin: string): Promise<void> {
    const reason = weakPinReason(pin)
    if (reason) throw new WeakPinError(reason)
    const locked = await lockSeedWithPin(Uint8Array.from(seed), pin)
    const stored: StoredPinSeed = { seed_enc_pin: b64(locked.seed_enc_pin), salt: b64(locked.salt) }
    await this.storage.set(KEY_SEED_PIN, JSON.stringify(stored))
    await this.guard.reset()
  }

  async unlockWithPin(pin: string): Promise<Uint8Array> {
    const status = await this.guard.check()
    if (!status.allowed) throw new PinLockedError(status.retryInSeconds)
    const raw = await this.storage.get(KEY_SEED_PIN)
    if (!raw) throw new Error('aucun seed sur ce device')
    const stored = JSON.parse(raw) as StoredPinSeed
    try {
      const seed = await unlockSeedWithPin({ seed_enc_pin: fromB64(stored.seed_enc_pin), salt: fromB64(stored.salt) }, pin)
      await this.guard.reset()
      return seed
    } catch {
      throw new PinInvalidError(await this.guard.recordFailure())
    }
  }

  async changePin(currentPin: string, newPin: string): Promise<void> {
    const reason = weakPinReason(newPin)
    if (reason) throw new WeakPinError(reason)
    const seed = await this.unlockWithPin(currentPin)
    try {
      await this.setupPin(seed, newPin)
    } finally {
      wipe(seed)
    }
  }

  async hasBiometrics(): Promise<boolean> {
    return (await this.storage.get(KEY_SEED_BIO)) !== null
  }

  /** K_bio aléatoire, gardée avec authentification requise ; le seed de l'appelant reste intact. */
  async enableBiometrics(seed: Uint8Array): Promise<void> {
    const bioKey = await randomBytes(32)
    try {
      await this.storage.set(KEY_BIO, b64(bioKey), { requireAuthentication: true, authenticationPrompt: this.biometricPrompt })
      await this.storage.set(KEY_SEED_BIO, b64(await seal(bioKey, seed)))
    } finally {
      wipe(bioKey)
    }
  }

  async unlockWithBiometrics(): Promise<Uint8Array> {
    const sealed = await this.storage.get(KEY_SEED_BIO)
    if (!sealed) throw new Error('biométrie non activée sur ce device')
    const keyB64 = await this.storage.get(KEY_BIO, { requireAuthentication: true, authenticationPrompt: this.biometricPrompt })
    if (!keyB64) throw new Error('biométrie non activée sur ce device')
    const bioKey = fromB64(keyB64)
    try {
      return await open(bioKey, fromB64(sealed))
    } finally {
      wipe(bioKey)
    }
  }

  async disableBiometrics(): Promise<void> {
    await this.storage.delete(KEY_SEED_BIO)
    await this.storage.delete(KEY_BIO)
  }

  /** Nouveau device, ou l'utilisateur quitte Relais sur celui-ci : plus rien. */
  async wipe(): Promise<void> {
    await this.disableBiometrics()
    await this.storage.delete(KEY_SEED_PIN)
    await this.guard.reset()
  }
}
