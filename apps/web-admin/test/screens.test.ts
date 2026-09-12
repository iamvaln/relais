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
