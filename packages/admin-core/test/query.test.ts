// Filtres de la liste des utilisateurs → chaîne de requête de GET /admin/users.
// Les valeurs vides ne partent pas ; page et limite sont des entiers en texte
// (l'API ne coerce pas les paramètres).
import { describe, expect, it } from 'vitest'
import { auditQuery, questionsQuery, subscriptionsQuery, ticketsQuery, transmissionsQuery, usersQuery } from '../src/query.js'

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

describe('transmissionsQuery et questionsQuery', () => {
  it('même règle : les vides ne partent pas, page et limite en texte', () => {
    expect(transmissionsQuery({})).toBe('')
    expect(transmissionsQuery({ status: 'in_progress', page: 2, limit: 10 })).toBe('?status=in_progress&page=2&limit=10')
    expect(questionsQuery({ usage_type: 'journal', status: '', category: 'work' })).toBe('?usage_type=journal&category=work')
  })
})

describe('subscriptionsQuery, ticketsQuery, auditQuery', () => {
  it('même règle pour la facturation, les tickets et le journal d’audit', () => {
    expect(subscriptionsQuery({ search: 'adjoua', plan: 'premium', status: '', page: 3 })).toBe('?search=adjoua&plan=premium&page=3')
    expect(ticketsQuery({ status: 'open', priority: '', category: 'rgpd', limit: 50 })).toBe('?status=open&category=rgpd&limit=50')
    expect(auditQuery({ action: 'CONFIG_UPDATE', admin_id: '', target_id: 'dms.escrow_ttl_hours', from: '2026-09-01', to: '', page: 1 })).toBe('?action=CONFIG_UPDATE&target_id=dms.escrow_ttl_hours&from=2026-09-01&page=1')
    expect(auditQuery({})).toBe('')
  })
})
