// Où envoyer l'utilisateur à l'ouverture (Frontend §3.2-3.4, DEC-03/04) :
// pas de compte → accueil ; device sans seed → restauration ; seed présent
// et clés absentes → déverrouillage ; tout est là → tableau de bord.

import { describe, expect, it } from 'vitest'
import { entryRoute } from '../src/state/routing'

describe('entryRoute', () => {
  it('choisit l’écran d’entrée selon la session, le device et le KeyStore', () => {
    expect(entryRoute({ session: 'anonymous', deviceHasSeed: false, keys: 'locked' })).toBe('/welcome')
    expect(entryRoute({ session: 'anonymous', deviceHasSeed: true, keys: 'locked' })).toBe('/login')
    expect(entryRoute({ session: 'authenticated', deviceHasSeed: false, keys: 'locked' })).toBe('/restore')
    expect(entryRoute({ session: 'authenticated', deviceHasSeed: true, keys: 'locked' })).toBe('/unlock')
    expect(entryRoute({ session: 'authenticated', deviceHasSeed: true, keys: 'unlocked' })).toBe('/home')
    expect(entryRoute({ session: 'onboarding', deviceHasSeed: false, keys: 'locked' })).toBe('/onboarding/register')
  })
})
