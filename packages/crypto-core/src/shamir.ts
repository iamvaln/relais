// Partage de secret de Shamir, N-of-M, sur GF(2^8) (Techniques §4).
//
// Chaque octet du secret est le terme constant d'un polynôme aléatoire de
// degré N−1 sur GF(256) ; la part i est l'évaluation en x = i (1..M).
// Recombiner = interpolation de Lagrange en x = 0 avec N parts quelconques.
// N−1 parts ne disent rien : pour tout secret candidat il existe un polynôme
// qui passe par elles.
//
// Corps : polynôme AES x^8 + x^4 + x^3 + x + 1 (0x11b), tables exp/log de
// générateur 3. Parts de 33 octets : [index][32 octets]. Implémentation
// maison (décision du 11/09/2026) — pas de dépendance, tests de propriété.

import sodium from './sodium.js'

export const SECRET_BYTES = 32
export const SHARE_BYTES = SECRET_BYTES + 1
const MAX_SHARES = 255

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    // x *= 3  ⇔  x = (x << 1) ^ x, réduit par 0x11b
    x = x ^ (x << 1)
    if (x & 0x100) x ^= 0x11b
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a]! + LOG[b]!]!
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('division par zéro dans GF(256)')
  if (a === 0) return 0
  return EXP[(LOG[a]! - LOG[b]! + 255) % 255]!
}

/** Évalue le polynôme (coefficients a0..a_{k-1}, a0 = secret) en x, schéma de Horner. */
function evaluate(coefficients: Uint8Array, x: number): number {
  let y = 0
  for (let i = coefficients.length - 1; i >= 0; i--) y = gfMul(y, x) ^ coefficients[i]!
  return y
}

/** M parts de 33 octets dont N suffisent. */
export function split(secret: Uint8Array, n: number, m: number): Uint8Array[] {
  if (secret.length !== SECRET_BYTES) throw new Error(`secret : ${SECRET_BYTES} octets attendus`)
  if (!Number.isInteger(n) || n < 2) throw new Error('N doit être un entier ≥ 2')
  if (!Number.isInteger(m) || m < n || m > MAX_SHARES) throw new Error(`M doit être un entier entre N et ${MAX_SHARES}`)

  const shares = Array.from({ length: m }, (_, i) => {
    const s = new Uint8Array(SHARE_BYTES)
    s[0] = i + 1
    return s
  })
  const coefficients = new Uint8Array(n)
  for (let byte = 0; byte < SECRET_BYTES; byte++) {
    coefficients[0] = secret[byte]!
    coefficients.set(sodium.randombytes_buf(n - 1), 1)
    for (const s of shares) s[1 + byte] = evaluate(coefficients, s[0]!)
  }
  coefficients.fill(0)
  return shares
}

/** Recombine N parts (ou plus). Avec moins de N parts le résultat est faux sans qu'on puisse le détecter : l'appelant connaît N. */
export function combine(shares: Uint8Array[]): Uint8Array {
  if (shares.length === 0) throw new Error('aucune part')
  const xs: number[] = []
  for (const s of shares) {
    if (s.length !== SHARE_BYTES) throw new Error(`part : ${SHARE_BYTES} octets attendus`)
    if (s[0] === 0) throw new Error('index de part nul')
    if (xs.includes(s[0]!)) throw new Error('part dupliquée')
    xs.push(s[0]!)
  }
  const secret = new Uint8Array(SECRET_BYTES)
  for (let byte = 0; byte < SECRET_BYTES; byte++) {
    let acc = 0
    for (let i = 0; i < shares.length; i++) {
      // Base de Lagrange en x = 0 : Π_{j≠i} x_j / (x_j − x_i) ; en caractéristique 2, − est ⊕.
      let basis = 1
      for (let j = 0; j < shares.length; j++) {
        if (j === i) continue
        basis = gfMul(basis, gfDiv(xs[j]!, xs[j]! ^ xs[i]!))
      }
      acc ^= gfMul(shares[i]![1 + byte]!, basis)
    }
    secret[byte] = acc
  }
  return secret
}
