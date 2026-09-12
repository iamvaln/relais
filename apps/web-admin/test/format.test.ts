// Mise en forme des valeurs du back office : dates courtes FR/EN, montants en
// FCFA, taux, libellés de statut — sans dépendre de l'heure locale du poste.
import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatFcfa, formatRate } from '../src/format'

describe('format', () => {
  it('dates ISO → jour lisible, en UTC, dans la langue ; null → tiret', () => {
    expect(formatDate('2026-09-12T10:23:43.000Z', 'fr')).toBe('12/09/2026')
    expect(formatDate('2026-09-12T10:23:43.000Z', 'en')).toBe('2026-09-12')
    expect(formatDateTime('2026-09-12T10:23:43.000Z', 'fr')).toBe('12/09/2026 10:23')
    expect(formatDate(null, 'fr')).toBe('—')
  })

  it('montants en FCFA avec séparateur de milliers ; taux en pourcentage entier ; null → tiret', () => {
    expect(formatFcfa(10000)).toBe('10 000 FCFA')
    expect(formatFcfa(0)).toBe('0 FCFA')
    expect(formatRate(0.8734)).toBe('87 %')
    expect(formatRate(null)).toBe('—')
  })
})
