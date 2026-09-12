// Ce que les écrans de transmission disent sans jargon (E3-US01, E3-US05) et
// comment un problème d'activation devient une phrase.

import { describe, expect, it } from 'vitest'
import { activationProblemKey, checkinOccasions, schemaSentence, transmissionStatusLine } from '../src/lib/transmission'
import { t } from '../src/i18n/index'

describe('transmission — phrases', () => {
  it('E3-US05 : combien de fois on peut répondre avant le déclenchement', () => {
    expect(checkinOccasions(3, 4)).toBe(3)
    expect(checkinOccasions(1, 1)).toBe(4)
    expect(checkinOccasions(6, 2)).toBe(12)
    expect(checkinOccasions(1, 4)).toBe(1)
  })

  it('E3-US01 : « Il faudra que 2 de vos 3 contacts répondent »', () => {
    expect(schemaSentence('fr', 2, 3)).toBe('Il faudra que 2 de tes 3 contacts répondent pour accéder à tes informations.')
    expect(schemaSentence('en', 2, 2)).toBe('Both of your 2 contacts will need to answer to access your information.')
    expect(schemaSentence('fr', 2, 2)).toBe('Tes 2 contacts devront répondre tous les deux pour accéder à tes informations.')
  })

  it('chaque problème d’activation a sa phrase, en FR et en EN', () => {
    expect(t('fr', activationProblemKey({ code: 'too_few_contacts' }))).toContain('2 contacts')
    expect(t('fr', activationProblemKey({ code: 'no_k1_holder' }))).toContain('Gestionnaire pratique')
    expect(t('en', activationProblemKey({ code: 'role_holders_below_n', slot: 'k3', holders: 1 }), { role: 'x', holders: 1, n: 2 })).toContain('x')
    expect(t('fr', activationProblemKey({ code: 'missing_answers', contactId: 'c' }), { name: 'Hervé' })).toContain('Hervé')
    expect(t('fr', activationProblemKey({ code: 'schema_m_mismatch', m: 3, contacts: 2 }))).toBeTruthy()
  })

  it('la ligne du tableau de bord suit le statut', () => {
    expect(transmissionStatusLine('fr', { status: 'inactive', pause_until: null, contacts: 0 })).toBe('Transmission : pas encore configurée')
    expect(transmissionStatusLine('fr', { status: 'inactive', pause_until: null, contacts: 2 })).toBe('Transmission : configurée, pas encore activée')
    expect(transmissionStatusLine('fr', { status: 'active', pause_until: null, contacts: 2 })).toBe('Transmission active')
    expect(transmissionStatusLine('en', { status: 'paused', pause_until: '2026-10-12T00:00:00.000Z', contacts: 2 })).toMatch(/^Paused until /)
    expect(transmissionStatusLine('fr', { status: 'triggered', pause_until: null, contacts: 2 })).toBe('Transmission déclenchée')
  })
})
