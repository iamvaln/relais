import type { TicketCategory, TicketPriority, TicketStatus, TicketsFilter } from '@relais/admin-core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDateTime } from '../format'
import { label } from '../i18n'

export const TICKET_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed']
export const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'normal', 'low']
export const CATEGORIES: TicketCategory[] = ['account_locked', 'otp_issue', 'transmission', 'subscription', 'rgpd', 'other']
export const STATUS_CLASS: Record<string, string> = { open: 'warn', in_progress: 'info', resolved: 'ok', closed: '' }
export const PRIORITY_CLASS: Record<string, string> = { urgent: 'danger', high: 'warn', normal: '', low: '' }
const LIMIT = 20

export function ticketsFilterFromParams(p: URLSearchParams): TicketsFilter {
  const page = Number.parseInt(p.get('page') ?? '1', 10)
  return {
    status: (p.get('status') as TicketStatus | null) ?? '',
    priority: (p.get('priority') as TicketPriority | null) ?? '',
    category: (p.get('category') as TicketCategory | null) ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: LIMIT,
  }
}

export function TicketsScreen() {
  const { client, admin, t, lang } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const filter = ticketsFilterFromParams(params)
  const query = useQuery({ queryKey: ['tickets', filter], queryFn: () => client.tickets.list(filter), placeholderData: (prev) => prev, refetchInterval: 60_000 })

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
      <h1>{t('tk.title')}</h1>
      <div className="toolbar">
        <label>{t('tk.status')}
          <select value={filter.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {TICKET_STATUSES.map((s) => (<option key={s} value={s}>{label(lang, 'tstatus', s)}</option>))}
          </select>
        </label>
        <label>{t('tk.priority')}
          <select value={filter.priority ?? ''} onChange={(e) => set('priority', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {PRIORITIES.map((p) => (<option key={p} value={p}>{label(lang, 'prio', p)}</option>))}
          </select>
        </label>
        <label>{t('tk.category')}
          <select value={filter.category ?? ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {CATEGORIES.map((c) => (<option key={c} value={c}>{label(lang, 'tcat', c)}</option>))}
          </select>
        </label>
      </div>
      {query.error && <p className="error">{t('common.error', { message: query.error.message })}</p>}
      {query.data && (
        <>
          <p className="muted">{t('tk.count', { n: query.data.total })}</p>
          {query.data.items.length === 0 ? (
            <p>{t('tk.empty')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('tk.col.created')}</th>
                  <th>{t('tk.col.subject')}</th>
                  <th>{t('tk.category')}</th>
                  <th>{t('tk.priority')}</th>
                  <th>{t('tk.status')}</th>
                  <th>{t('tk.col.requester')}</th>
                  <th>{t('tk.col.assigned')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((x) => (
                  <tr key={x.id} className="row" onClick={() => navigate(`/tickets/${x.id}`)}>
                    <td>{formatDateTime(x.created_at, lang)}</td>
                    <td>{x.subject}</td>
                    <td>{label(lang, 'tcat', x.category)}</td>
                    <td><span className={`badge ${PRIORITY_CLASS[x.priority] ?? ''}`}>{label(lang, 'prio', x.priority)}</span></td>
                    <td><span className={`badge ${STATUS_CLASS[x.status] ?? ''}`}>{label(lang, 'tstatus', x.status)}</span></td>
                    <td>{x.user_email}</td>
                    <td className="muted">{x.assigned_to ? (x.assigned_to === admin?.id ? t('tk.me') : x.assigned_to.slice(0, 8)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="toolbar">
            <button type="button" className="secondary" disabled={(filter.page ?? 1) <= 1} onClick={() => set('page', String((filter.page ?? 1) - 1))}>{t('users.prev')}</button>
            <span className="muted">{t('users.page', { page: query.data.page, pages })}</span>
            <button type="button" className="secondary" disabled={(filter.page ?? 1) >= pages} onClick={() => set('page', String((filter.page ?? 1) + 1))}>{t('users.next')}</button>
          </div>
        </>
      )}
    </>
  )
}
