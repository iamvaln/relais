// Audit LOW-15 : sur une route inconnue, Fastify n'a pas de routeOptions.url et le
// journal recevait l'URL brute — un lien /relay/<token> mal tapé finissait dans Pino.
import { describe, expect, it } from 'vitest'
import { loggedPath } from '../src/app.js'

describe('loggedPath', () => {
  it('journalise le motif de route, jamais l’URL brute', () => {
    expect(loggedPath({ routeOptions: { url: '/relay/:token' }, url: '/relay/abc123' })).toBe('/relay/:token')
    expect(loggedPath({ routeOptions: { url: undefined }, url: '/relay/abc123' })).toBe('(unmatched)')
  })
})
