// FR d'abord, EN ensuite (décision du 12/09/2026) : mêmes clés dans les deux
// dictionnaires, interpolation {param}, repli sur le FR, langue du navigateur.
import { describe, expect, it } from 'vitest'
import { browserLang, dictionaries, t } from '../src/i18n'

describe('i18n', () => {
  it('les deux dictionnaires ont exactement les mêmes clés', () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries.fr).sort())
  })

  it('interpole les paramètres et lit la langue demandée', () => {
    expect(t('fr', 'users.count', { n: 3 })).toBe('3 utilisateurs')
    expect(t('en', 'users.count', { n: 3 })).toBe('3 users')
  })

  it('la langue du navigateur : fr par défaut, en si demandée', () => {
    expect(browserLang('en-US')).toBe('en')
    expect(browserLang('fr-CM')).toBe('fr')
    expect(browserLang(undefined)).toBe('fr')
  })
})
