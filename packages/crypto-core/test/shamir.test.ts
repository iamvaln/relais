// Shamir N-of-M sur 32 octets (Techniques §4) — implémentation maison GF(2^8),
// polynôme AES 0x11b, parts de 33 octets [index][32]. Décision du 11/09/2026.

import { describe, expect, it } from 'vitest'
import sodium from '../src/sodium.js'
import { SHARE_BYTES, combine, gfDiv, gfMul, split } from '../src/shamir.js'

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
}

describe('GF(2^8), polynôme 0x11b', () => {
  it('table AES : 0x53 · 0xca = 1 ; neutre ; division inverse de la multiplication', () => {
    expect(gfMul(0x53, 0xca)).toBe(1)
    expect(gfMul(0x57, 0x83)).toBe(0xc1) // exemple FIPS-197 §4.2
    expect(gfMul(0x7b, 1)).toBe(0x7b)
    expect(gfMul(0x7b, 0)).toBe(0)
    for (const a of [1, 2, 0x53, 0xff]) for (const b of [1, 3, 0xca, 0xfe]) expect(gfDiv(gfMul(a, b), b)).toBe(a)
    expect(() => gfDiv(1, 0)).toThrow(/zéro/)
  })
})

describe('split / combine', () => {
  it.each([
    [2, 2],
    [2, 3],
    [3, 5],
  ])('%i-of-%i : toute combinaison de N parts recombine ; N−1 parts ne donnent pas la clé', async (n, m) => {
    await sodium.ready
    const secret = sodium.randombytes_buf(32)
    const shares = split(secret, n, m)
    expect(shares).toHaveLength(m)
    expect(new Set(shares.map((s) => s[0])).size).toBe(m)
    for (const s of shares) {
      expect(s).toHaveLength(SHARE_BYTES)
      expect(s[0]).toBeGreaterThanOrEqual(1)
      expect(Buffer.from(s.subarray(1))).not.toEqual(Buffer.from(secret))
    }
    for (const subset of combinations(shares, n)) expect(Buffer.from(combine(subset))).toEqual(Buffer.from(secret))
    for (const subset of combinations(shares, n - 1)) {
      if (subset.length === 0) continue
      expect(Buffer.from(combine(subset))).not.toEqual(Buffer.from(secret))
    }
  })

  it('deux découpes du même secret donnent des parts différentes (coefficients aléatoires)', async () => {
    await sodium.ready
    const secret = sodium.randombytes_buf(32)
    const a = split(secret, 2, 3)
    const b = split(secret, 2, 3)
    expect(Buffer.from(a[0]!)).not.toEqual(Buffer.from(b[0]!))
  })

  it('paramètres refusés : N < 2, M < N, M > 255, secret ≠ 32 octets, parts dupliquées ou malformées', async () => {
    await sodium.ready
    const secret = sodium.randombytes_buf(32)
    expect(() => split(secret, 1, 2)).toThrow(/N/)
    expect(() => split(secret, 3, 2)).toThrow(/M/)
    expect(() => split(secret, 2, 256)).toThrow(/M/)
    expect(() => split(new Uint8Array(16), 2, 2)).toThrow(/32/)
    const shares = split(secret, 2, 3)
    expect(() => combine([shares[0]!, shares[0]!])).toThrow(/dupliqu/)
    expect(() => combine([shares[0]!, shares[1]!.subarray(0, 10)])).toThrow(/33/)
    expect(() => combine([])).toThrow(/part/)
  })
})
