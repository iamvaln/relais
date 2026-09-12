// BO-05 — valeurs de configuration typées. Le formulaire saisit du texte ;
// on le convertit selon config_type et on refuse ce que l'API refuserait
// (VALIDATION_ERROR). Double confirmation (décision du 12/09/2026) : motif
// obligatoire et ressaisie du nom de la clé, quelle que soit la catégorie.

export type ConfigType = 'string' | 'int' | 'bool' | 'json' | 'array_int'

export type ParsedConfig = { ok: true; value: unknown } | { ok: false }

const INT = /^-?\d+$/

export function parseConfigValue(type: string, text: string): ParsedConfig {
  const s = text.trim()
  switch (type) {
    case 'int':
      return INT.test(s) ? { ok: true, value: Number.parseInt(s, 10) } : { ok: false }
    case 'bool':
      return s === 'true' || s === 'false' ? { ok: true, value: s === 'true' } : { ok: false }
    case 'array_int': {
      const parts = (s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s).split(',').map((p) => p.trim())
      if (parts.length === 0 || parts.some((p) => !INT.test(p))) return { ok: false }
      return { ok: true, value: parts.map((p) => Number.parseInt(p, 10)) }
    }
    case 'json':
      try {
        return { ok: true, value: JSON.parse(s) as unknown }
      } catch {
        return { ok: false }
      }
    default:
      return { ok: true, value: text }
  }
}

/** La valeur rendue par l'API, sous la forme que le formulaire ressaisit. */
export function formatConfigValue(type: string, value: unknown): string {
  if (type === 'array_int' && Array.isArray(value)) return value.join(', ')
  if (type === 'json') return JSON.stringify(value)
  return String(value)
}

export function configChangeConfirmed(input: { key: string; typedKey: string; reason: string }): boolean {
  return input.reason.trim().length > 0 && input.typedKey.trim() === input.key
}
