import type { TransmissionRunStatus, TransmissionsFilter } from '@relais/admin-core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDateTime } from '../format'
import { label } from '../i18n'

export const RUN_STATUSES: TransmissionRunStatus[] = ['triggered', 'in_progress', 'completed', 'cancelled', 'expired']
const LIMIT = 20

export const RUN_CLASS: Record<string, string> = { triggered: 'warn', in_progress: 'info', completed: 'ok', cancelled: '', expired: 'danger' }

export function transmissionsFilterFromParams(p: URLSearchParams): TransmissionsFilter {
  const page = Number.parseInt(p.get('page') ?? '1', 10)
  return { status: (p.get('status') as TransmissionRunStatus | null) ?? '', page: Number.isFinite(page) && page > 0 ? page : 1, limit: LIMIT }
}

export function unlockedLabel(u: { k1: boolean; k2: boolean; k3: boolean }): string {
  const keys = (['k1', 'k2', 'k3'] as const).filter((k) => u[k]).map((k) => k.toUpperCase())
  return keys.length ? keys.join(' ') : '—'
}

export function TransmissionsScreen() {
  const { client, t, lang } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const filter = transmissionsFilterFromParams(params)
  const query = useQuery({ queryKey: ['transmissions', filter], queryFn: () => client.transmissions.list(filter), placeholderData: (prev) => prev, refetchInterval: 60_000 })

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
      <h1>{t('trs.title')}</h1>
      <div className="toolbar">
        <label>
          {t('trs.status')}
          <select value={filter.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>{label(lang, 'run', s)}</option>
            ))}
          </select>
        </label>
      </div>
      {query.error && <p className="error">{t('common.error', { message: query.error.message })}</p>}
      {query.data && (
        <>
          <p className="muted">{t('trs.count', { n: query.data.total })}</p>
          {query.data.items.length === 0 ? (
            <p>{t('trs.empty')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('trs.col.triggered')}</th>
                  <th>{t('trs.col.status')}</th>
                  <th>{t('trs.col.schema')}</th>
                  <th>{t('trs.col.contacts')}</th>
                  <th>{t('trs.col.unlocked')}</th>
                  <th>{t('trs.col.escrow')}</th>
                  <th>{t('trs.col.extensions')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((x) => (
                  <tr key={x.id} className="row" onClick={() => navigate(`/transmissions/${x.id}`)}>
                    <td>{formatDateTime(x.triggered_at, lang)}</td>
                    <td><span className={`badge ${RUN_CLASS[x.status] ?? ''}`}>{label(lang, 'run', x.status)}</span></td>
                    <td>{x.schema.n}/{x.schema.m}</td>
                    <td>{x.contacts_confirmed}/{x.contacts_notified}</td>
                    <td>{unlockedLabel(x.unlocked)}</td>
                    <td>{x.escrow_active ? t('trs.hoursLeft', { h: Math.floor(x.escrow_ttl_seconds / 3600) }) : t('trs.escrowExpired')}</td>
                    <td>{x.escrow_extended_count}</td>
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
