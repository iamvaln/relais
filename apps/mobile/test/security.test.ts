// Réglages sécurité : ce que l'écran dit de la biométrie, pur, testé sous Node.

import { describe, expect, it } from 'vitest'
import { biometricsStatusLine } from '../src/lib/security'

describe('biometricsStatusLine', () => {
  it('indisponible sur ce téléphone, activée, désactivée — FR et EN', () => {
    expect(biometricsStatusLine('fr', { available: false, enabled: false })).toBe('Biométrie : non configurée sur ce téléphone')
    expect(biometricsStatusLine('fr', { available: true, enabled: true })).toBe('Biométrie : activée')
    expect(biometricsStatusLine('fr', { available: true, enabled: false })).toBe('Biométrie : désactivée')
    expect(biometricsStatusLine('en', { available: true, enabled: false })).toBe('Biometrics: off')
    // activée sur l'app mais plus configurée sur le téléphone : on le dit, la désactivation reste possible
    expect(biometricsStatusLine('en', { available: false, enabled: true })).toBe('Biometrics: on, but not set up on this phone anymore')
  })
})
