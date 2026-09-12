// Filtres de la liste des utilisateurs → chaîne de requête de GET /admin/users.
// Les valeurs vides ne partent pas ; page et limite sont des entiers en texte
// (l'API ne coerce pas les paramètres).
import { describe, expect, it } from 'vitest'
import { usersQuery } from '../src/users.js'

describe('usersQuery', () => {
  it('rien → chaîne vide', () => {
    expect(usersQuery({})).toBe('')
  })

  it('encode les filtres renseignés, ignore les vides, met page et limite en texte', () => {
    expect(usersQuery({ search: 'adjoua ngo', plan: 'premium', status: '', transmission: undefined, created_from: '2026-01-01', page: 2, limit: 50 })).toBe(
      '?search=adjoua+ngo&plan=premium&created_from=2026-01-01&page=2&limit=50',
    )
  })
})
