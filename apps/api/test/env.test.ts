// TRUST_PROXY (audit HIGH-4) : faux par défaut — X-Forwarded-For n'est cru
// qu'en production derrière un proxy connu, par nombre de sauts ou liste d'IP.

import { describe, expect, it } from 'vitest'
import { parseTrustProxy } from '../src/config/env.js'

describe('parseTrustProxy', () => {
  it('absent ou false → false ; true → true ; un entier → nombre de sauts ; une liste → IP du proxy', () => {
    expect(parseTrustProxy(undefined)).toBe(false)
    expect(parseTrustProxy('false')).toBe(false)
    expect(parseTrustProxy('true')).toBe(true)
    const one = parseTrustProxy('1')
    if (typeof one !== 'function') throw new Error('un nombre de sauts devient une fonction')
    expect([one('10.0.0.1', 0), one('10.0.0.1', 1)]).toEqual([true, false])
    const two = parseTrustProxy('2')
    if (typeof two !== 'function') throw new Error('un nombre de sauts devient une fonction')
    expect([two('x', 0), two('x', 1), two('x', 2)]).toEqual([true, true, false])
    expect(parseTrustProxy('10.0.0.1, 10.0.0.2')).toBe('10.0.0.1,10.0.0.2')
    expect(parseTrustProxy('loopback')).toBe('loopback')
  })
})
