// Réglages sécurité : phrases pures, testées sous Node.

import { type Language, t } from '../i18n'

/** Ce que l'écran dit de la biométrie : configurée sur le téléphone ou non, activée dans Relais ou non. */
export function biometricsStatusLine(lang: Language, s: { available: boolean; enabled: boolean }): string {
  if (s.enabled) return t(lang, s.available ? 'security.bioOn' : 'security.bioOnUnavailable')
  return t(lang, s.available ? 'security.bioOff' : 'security.bioUnavailable')
}
