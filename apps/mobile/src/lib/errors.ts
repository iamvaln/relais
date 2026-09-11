import { ApiError, NetworkError } from '@relais/api-client'
import { t, type Language, type MessageKey } from '@/i18n'

/** Message à afficher pour une erreur de flow ; `map` traduit un code API en clé. */
export function messageFor(err: unknown, lang: Language, map: Record<string, MessageKey> = {}): string {
  if (err instanceof ApiError) {
    const key = map[err.code]
    if (key) return t(lang, key)
    return err.message || t(lang, 'common.error')
  }
  if (err instanceof NetworkError) return t(lang, 'health.offline')
  if (err instanceof Error && err.message) return err.message
  return t(lang, 'common.error')
}
