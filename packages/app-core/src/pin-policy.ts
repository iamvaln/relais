// PIN à 6 chiffres (E1-US03) et backoff progressif (DEC-26, Techniques §7.2).
//
// Refusés : autre chose que 6 chiffres, un seul chiffre répété, une suite
// montante ou descendante, un motif répété (123123, 121212, 112233).
// Backoff : 5 tentatives libres ; à partir du 5ᵉ échec, blocage de
// steps[min(échecs − 5, dernier)] secondes — [30, 120, 600, 1800] par
// défaut, valeur de security.pin_backoff_steps si l'app l'a reçue.
// L'état (échecs, fin de blocage) est persisté : un redémarrage ne remet
// pas le compteur à zéro.

import type { SecureStorage } from './secure-storage.js'

export type WeakPinReason = 'format' | 'repeated' | 'sequence' | 'pattern'

export const DEFAULT_BACKOFF_STEPS = [30, 120, 600, 1800]
const FREE_ATTEMPTS = 5
const STORAGE_KEY = 'relais.pin.guard'

export function weakPinReason(pin: string): WeakPinReason | null {
  if (!/^[0-9]{6}$/.test(pin)) return 'format'
  const d = [...pin].map(Number)
  if (d.every((x) => x === d[0])) return 'repeated'
  const up = d.every((x, i) => i === 0 || x === d[i - 1]! + 1)
  const down = d.every((x, i) => i === 0 || x === d[i - 1]! - 1)
  if (up || down) return 'sequence'
  if (pin.slice(0, 3) === pin.slice(3)) return 'pattern' // 123123
  if (pin.slice(0, 2) === pin.slice(2, 4) && pin.slice(2, 4) === pin.slice(4)) return 'pattern' // 121212
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5]) return 'pattern' // 112233
  return null
}

export function lockSeconds(failCount: number, steps: number[] = DEFAULT_BACKOFF_STEPS): number {
  if (failCount < FREE_ATTEMPTS || steps.length === 0) return 0
  return steps[Math.min(failCount - FREE_ATTEMPTS, steps.length - 1)]!
}

export interface PinGuardStatus {
  allowed: boolean
  failCount: number
  retryInSeconds: number
}

interface GuardState {
  failCount: number
  lockedUntil: number | null
}

export class PinGuard {
  private readonly now: () => number
  private readonly steps: number[]

  constructor(
    private readonly storage: SecureStorage,
    options: { now?: () => number; steps?: number[] } = {},
  ) {
    this.now = options.now ?? Date.now
    this.steps = options.steps ?? DEFAULT_BACKOFF_STEPS
  }

  private async load(): Promise<GuardState> {
    const raw = await this.storage.get(STORAGE_KEY)
    if (!raw) return { failCount: 0, lockedUntil: null }
    try {
      const parsed = JSON.parse(raw) as Partial<GuardState>
      return { failCount: Number(parsed.failCount ?? 0), lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : null }
    } catch {
      return { failCount: 0, lockedUntil: null }
    }
  }

  async check(): Promise<PinGuardStatus> {
    const s = await this.load()
    const remaining = s.lockedUntil === null ? 0 : Math.max(0, Math.ceil((s.lockedUntil - this.now()) / 1000))
    return { allowed: remaining === 0, failCount: s.failCount, retryInSeconds: remaining }
  }

  async recordFailure(): Promise<PinGuardStatus> {
    const s = await this.load()
    const failCount = s.failCount + 1
    const seconds = lockSeconds(failCount, this.steps)
    const lockedUntil = seconds > 0 ? this.now() + seconds * 1000 : null
    await this.storage.set(STORAGE_KEY, JSON.stringify({ failCount, lockedUntil } satisfies GuardState))
    return this.check()
  }

  async reset(): Promise<void> {
    await this.storage.delete(STORAGE_KEY)
  }
}
