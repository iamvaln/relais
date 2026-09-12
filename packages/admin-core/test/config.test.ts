// BO-05 — la configuration est typée côté API (int, bool, array_int, json,
// string) : le formulaire saisit du texte, admin-core le convertit et refuse
// ce que l'API refuserait. Double confirmation (décision du 12/09/2026) :
// motif obligatoire et ressaisie du nom de la clé, quelle que soit la catégorie.
import { describe, expect, it } from 'vitest'
import { configChangeConfirmed, formatConfigValue, parseConfigValue } from '../src/config.js'

describe('parseConfigValue', () => {
  it('int : entier (espaces tolérés), sinon refus', () => {
    expect(parseConfigValue('int', ' 12 ')).toEqual({ ok: true, value: 12 })
    expect(parseConfigValue('int', '-3')).toEqual({ ok: true, value: -3 })
    expect(parseConfigValue('int', 'douze')).toEqual({ ok: false })
    expect(parseConfigValue('int', '1.5')).toEqual({ ok: false })
    expect(parseConfigValue('int', '')).toEqual({ ok: false })
  })

  it('bool : true ou false seulement', () => {
    expect(parseConfigValue('bool', 'true')).toEqual({ ok: true, value: true })
    expect(parseConfigValue('bool', 'false')).toEqual({ ok: true, value: false })
    expect(parseConfigValue('bool', 'oui')).toEqual({ ok: false })
  })

  it('array_int : entiers séparés par des virgules, ou tableau JSON', () => {
    expect(parseConfigValue('array_int', '7, 14, 21')).toEqual({ ok: true, value: [7, 14, 21] })
    expect(parseConfigValue('array_int', '[1,3,6]')).toEqual({ ok: true, value: [1, 3, 6] })
    expect(parseConfigValue('array_int', '7, x')).toEqual({ ok: false })
    expect(parseConfigValue('array_int', '')).toEqual({ ok: false })
  })

  it('json : document valide ; string : tel quel', () => {
    expect(parseConfigValue('json', '{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseConfigValue('json', '{')).toEqual({ ok: false })
    expect(parseConfigValue('string', 'abc')).toEqual({ ok: true, value: 'abc' })
  })
})

describe('formatConfigValue', () => {
  it('rend la valeur de l’API sous la forme que le formulaire ressaisit', () => {
    expect(formatConfigValue('array_int', [7, 14, 21])).toBe('7, 14, 21')
    expect(formatConfigValue('json', { a: 1 })).toBe('{"a":1}')
    expect(formatConfigValue('bool', true)).toBe('true')
    expect(formatConfigValue('int', 5)).toBe('5')
    expect(formatConfigValue('string', 'x')).toBe('x')
  })
})

describe('configChangeConfirmed', () => {
  it('motif non vide et nom de la clé ressaisi à l’identique', () => {
    expect(configChangeConfirmed({ key: 'dms.escrow_ttl_hours', typedKey: 'dms.escrow_ttl_hours', reason: 'incident du 12/09' })).toBe(true)
    expect(configChangeConfirmed({ key: 'dms.escrow_ttl_hours', typedKey: ' dms.escrow_ttl_hours ', reason: 'x' })).toBe(true)
    expect(configChangeConfirmed({ key: 'dms.escrow_ttl_hours', typedKey: 'dms.escrow_ttl_hour', reason: 'x' })).toBe(false)
    expect(configChangeConfirmed({ key: 'dms.escrow_ttl_hours', typedKey: 'dms.escrow_ttl_hours', reason: '   ' })).toBe(false)
  })
})
