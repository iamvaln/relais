// Helpers purs des écrans : filtres depuis l'URL, actions permises par rôle.
import { describe, expect, it } from 'vitest'
import { allowedActions } from '../src/screens/user'
import { filterFromParams } from '../src/screens/users'

describe('filterFromParams', () => {
  it('lit les filtres de l’URL, page 1 par défaut, limite fixe', () => {
    expect(filterFromParams(new URLSearchParams('?search=adjoua&plan=premium&page=3'))).toEqual({ search: 'adjoua', plan: 'premium', status: '', transmission: '', page: 3, limit: 20 })
    expect(filterFromParams(new URLSearchParams('?page=zéro')).page).toBe(1)
  })
})

describe('allowedActions', () => {
  it('support débloque et regénère ; admin suspend et change l’email ; super_admin supprime ; finance rien', () => {
    expect(allowedActions('support')).toEqual(['unblock', 'otp'])
    expect(allowedActions('admin')).toEqual(['unblock', 'otp', 'suspend', 'email'])
    expect(allowedActions('super_admin')).toEqual(['unblock', 'otp', 'suspend', 'email', 'delete'])
    expect(allowedActions('finance')).toEqual([])
  })
})

describe('lot 2 — transmissions', () => {
  it('filtre de la liste depuis l’URL : statut et page', async () => {
    const { transmissionsFilterFromParams } = await import('../src/screens/transmissions')
    expect(transmissionsFilterFromParams(new URLSearchParams('?status=in_progress&page=2'))).toEqual({ status: 'in_progress', page: 2, limit: 20 })
    expect(transmissionsFilterFromParams(new URLSearchParams(''))).toEqual({ status: '', page: 1, limit: 20 })
  })

  it('actions par rôle (grille BO-03) : support débloque ; admin étend et relance ; super_admin annule ; finance rien', async () => {
    const { allowedTransmissionActions } = await import('../src/screens/transmission')
    expect(allowedTransmissionActions('support')).toEqual(['unblock'])
    expect(allowedTransmissionActions('admin')).toEqual(['extend', 'notify', 'unblock'])
    expect(allowedTransmissionActions('super_admin')).toEqual(['extend', 'notify', 'cancel', 'unblock'])
    expect(allowedTransmissionActions('finance')).toEqual([])
  })
})

describe('lot 2 — questions', () => {
  it('filtre depuis l’URL : usage, statut (actives par défaut), catégorie', async () => {
    const { questionsFilterFromParams } = await import('../src/screens/questions')
    expect(questionsFilterFromParams(new URLSearchParams('?usage_type=journal&category=work'))).toEqual({ usage_type: 'journal', status: 'active', category: 'work' })
    expect(questionsFilterFromParams(new URLSearchParams('?status=all'))).toEqual({ usage_type: '', status: '', category: '' })
  })
})
