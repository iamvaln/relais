import type { TransmissionStatus, UserPlan, UserStatus, UsersFilter } from '@relais/admin-core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDate } from '../format'
import { label } from '../i18n'

const PLANS: UserPlan[] = ['free', 'premium']
const STATUSES: UserStatus[] = ['pending_verification', 'active', 'suspended', 'deleted']
const TX: TransmissionStatus[] = ['inactive', 'active', 'paused', 'triggered', 'completed']
const LIMIT = 20

/** Les filtres vivent dans l'URL : partageables, et le bouton retour les garde. */
export function filterFromParams(p: URLSearchParams): UsersFilter {
  const page = Number.parseInt(p.get('page') ?? '1', 10)
  return {
    search: p.get('search') ?? '',
    plan: (p.get('plan') as UserPlan | null) ?? '',
    status: (p.get('status') as UserStatus | null) ?? '',
    transmission: (p.get('transmission') as TransmissionStatus | null) ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: LIMIT,
  }
}

export function UsersScreen() {
  const { client, t, lang } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const filter = filterFromParams(params)
  const query = useQuery({ queryKey: ['users', filter], queryFn: () => client.users.list(filter), placeholderData: (prev) => prev })

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.limit)) : 1

  return (
    <>
      <h1>{t('users.title')}</h1>
      <div className="toolbar">
        <label className="grow">
          {t('users.search')}
          <input value={filter.search ?? ''} onChange={(e) => set('search', e.target.value)} />
        </label>
        <label>
          {t('users.plan')}
          <select value={filter.plan ?? ''} onChange={(e) => set('plan', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {PLANS.map((p) => (
              <option key={p} value={p}>{label(lang, 'plan', p)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('users.status')}
          <select value={filter.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{label(lang, 'status', s)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('users.transmission')}
          <select value={filter.transmission ?? ''} onChange={(e) => set('transmission', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {TX.map((s) => (
              <option key={s} value={s}>{label(lang, 'tx', s)}</option>
            ))}
          </select>
        </label>
      </div>
      {query.error && <p className="error">{t('common.error', { message: query.error.message })}</p>}
      {query.data && (
        <>
          <p className="muted">{t('users.count', { n: query.data.total })}</p>
          {query.data.items.length === 0 ? (
            <p>{t('users.empty')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('users.col.name')}</th>
                  <th>{t('users.col.email')}</th>
                  <th>{t('users.col.plan')}</th>
                  <th>{t('users.col.status')}</th>
                  <th>{t('users.col.transmission')}</th>
                  <th>{t('users.col.lastCheckin')}</th>
                  <th>{t('users.col.created')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((u) => (
                  <tr key={u.id} className="row" onClick={() => navigate(`/users/${u.id}`)}>
                    <td>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td>{label(lang, 'plan', u.plan)}</td>
                    <td>
                      <span className={`badge ${u.account_status === 'active' ? 'ok' : u.account_status === 'suspended' ? 'danger' : ''}`}>{label(lang, 'status', u.account_status)}</span>
                    </td>
                    <td>{label(lang, 'tx', u.transmission_status)}</td>
                    <td>{formatDate(u.last_checkin_at, lang)}</td>
                    <td>{formatDate(u.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="toolbar">
            <button type="button" className="secondary" disabled={(filter.page ?? 1) <= 1} onClick={() => set('page', String((filter.page ?? 1) - 1))}>
              {t('users.prev')}
            </button>
            <span className="muted">{t('users.page', { page: query.data.page, pages })}</span>
            <button type="button" className="secondary" disabled={(filter.page ?? 1) >= pages} onClick={() => set('page', String((filter.page ?? 1) + 1))}>
              {t('users.next')}
            </button>
          </div>
        </>
      )}
    </>
  )
}
