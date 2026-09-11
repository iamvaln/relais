// FR et EN doivent couvrir les mêmes clés, sans chaîne vide ; t() rend la
// langue demandée et retombe sur le français.

import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en'
import { fr } from '../src/i18n/fr'
import { t } from '../src/i18n/index'

describe('i18n', () => {
  it('mêmes clés en FR et EN, aucune vide', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
    for (const dict of [fr, en]) for (const [k, v] of Object.entries(dict)) expect(v.trim().length, k).toBeGreaterThan(0)
  })

  it('t() choisit la langue et interpole', () => {
    expect(t('fr', 'health.title')).toBe(fr['health.title'])
    expect(t('en', 'health.title')).toBe(en['health.title'])
    expect(t('fr', 'health.apiStatus', { status: 'ok' })).toContain('ok')
  })
})
