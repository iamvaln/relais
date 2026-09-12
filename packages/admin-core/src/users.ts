// BO-02 — filtres de la liste vers la chaîne de requête de GET /admin/users.
// L'API ne coerce pas ses paramètres : page et limite partent en texte.

import type { UsersFilter } from './types.js'

export function usersQuery(filter: UsersFilter): string {
  const params = new URLSearchParams()
  const text: (keyof UsersFilter)[] = ['search', 'plan', 'status', 'transmission', 'created_from', 'created_to']
  for (const key of text) {
    const v = filter[key]
    if (typeof v === 'string' && v.trim() !== '') params.set(key, v.trim())
  }
  if (filter.page !== undefined) params.set('page', String(filter.page))
  if (filter.limit !== undefined) params.set('limit', String(filter.limit))
  const s = params.toString()
  return s ? `?${s}` : ''
}
