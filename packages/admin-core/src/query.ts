// Filtres des listes vers la chaîne de requête des GET /admin/*. L'API ne
// coerce pas ses paramètres : page et limite partent en texte ; les valeurs
// vides ne partent pas.

import type { QuestionsFilter, TransmissionsFilter, UsersFilter } from './types.js'

function toQuery<F extends object>(filter: F, textKeys: readonly (keyof F & string)[]): string {
  const params = new URLSearchParams()
  const raw = filter as Record<string, unknown>
  for (const key of textKeys) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim() !== '') params.set(key, v.trim())
  }
  if (raw['page'] !== undefined) params.set('page', String(raw['page']))
  if (raw['limit'] !== undefined) params.set('limit', String(raw['limit']))
  const s = params.toString()
  return s ? `?${s}` : ''
}

export function usersQuery(filter: UsersFilter): string {
  return toQuery(filter, ['search', 'plan', 'status', 'transmission', 'created_from', 'created_to'])
}

export function transmissionsQuery(filter: TransmissionsFilter): string {
  return toQuery(filter, ['status'])
}

export function questionsQuery(filter: QuestionsFilter): string {
  return toQuery(filter, ['usage_type', 'status', 'category'])
}
