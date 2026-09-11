// Le seed entre le PIN et l'écran biométrie : tenu quelques secondes, effacé
// dès que la biométrie est activée ou refusée. Jamais persisté.
import { wipe } from '@relais/crypto-core'

let seed: Uint8Array | null = null

export const pendingSeed = {
  set(s: Uint8Array): void {
    seed = s
  },
  take(): Uint8Array | null {
    const s = seed
    seed = null
    return s
  },
  clear(): void {
    if (seed) wipe(seed)
    seed = null
  },
}
