import { ApiError } from '@relais/api-client'
import { canAccess, type TicketPriority, type TicketStatus, type TicketUpdate } from '@relais/admin-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDateTime } from '../format'
import { label } from '../i18n'
import { PRIORITIES, PRIORITY_CLASS, STATUS_CLASS } from './tickets'

/** Les transitions offertes : ouvert → en cours (prise en charge) ou résolu d'un coup ; en cours → résolu ; résolu → fermé ou réouvert ; fermé → réouvert. */
export function nextTicketStatuses(status: string): TicketStatus[] {
  switch (status) {
    case 'open':
      return ['in_progress', 'resolved']
    case 'in_progress':
      return ['resolved']
    case 'resolved':
      return ['closed', 'open']
    case 'closed':
      return ['open']
    default:
      return []
  }
}

export function TicketScreen() {
  const { client, admin, t, lang } = useApp()
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => client.tickets.get(id), enabled: id.length > 0 })
  const admins = useQuery({ queryKey: ['admins'], queryFn: () => client.admins(), staleTime: 300_000 })
  const [resolving, setResolving] = useState(false)
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const run = useMutation({
    mutationFn: (changes: TicketUpdate | 'take') => (changes === 'take' ? client.tickets.take(id, admin?.id ?? '') : client.tickets.update(id, changes)),
    onSuccess: (data) => {
      qc.setQueryData(['ticket', id], data)
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      setResolving(false)
      setNote('')
      setNotice({ ok: true, text: t('action.done') })
    },
    onError: (err) => {
      const message = err instanceof ApiError && err.code === 'AUTH_FORBIDDEN' ? t('common.forbidden') : err.message
      setNotice({ ok: false, text: t('action.error', { message }) })
    },
  })

  if (ticket.isPending) return <p className="muted">{t('common.loading')}</p>
  if (ticket.error || !ticket.data) return <p className="error">{t('common.error', { message: ticket.error?.message ?? '' })}</p>
  const x = ticket.data
  const seesUsers = admin ? canAccess(admin.role, 'users') : false
  const transitions = nextTicketStatuses(x.status)
  const go = (status: TicketStatus) => {
    setNotice(null)
    if (status === 'in_progress' && x.status === 'open') run.mutate('take')
    else if (status === 'resolved') setResolving(true)
    else run.mutate({ status })
  }

  return (
    <>
      <p><Link to="/tickets">{t('tk.back')}</Link></p>
      <h1>
        {x.subject} <span className={`badge ${STATUS_CLASS[x.status] ?? ''}`}>{label(lang, 'tstatus', x.status)}</span>{' '}
        <span className={`badge ${PRIORITY_CLASS[x.priority] ?? ''}`}>{label(lang, 'prio', x.priority)}</span>
      </h1>
      <div className="grid">
        <section className="card">
          <h2>{t('tk.requester')}</h2>
          <dl className="dl">
            <dt>{t('users.col.email')}</dt><dd>{x.user_email}</dd>
            <dt>{t('user.title')}</dt>
            <dd>{x.user_id ? (seesUsers ? <Link to={`/users/${x.user_id}`}>{t('tk.userLink')}</Link> : x.user_id.slice(0, 8)) : t('tk.noAccount')}</dd>
            <dt>{t('tk.category')}</dt><dd>{label(lang, 'tcat', x.category)}</dd>
            <dt>{t('tk.col.created')}</dt><dd>{formatDateTime(x.created_at, lang)}</dd>
            <dt>{t('tk.updated')}</dt><dd>{formatDateTime(x.updated_at, lang)}</dd>
            {x.resolved_at && (<><dt>{t('tk.resolvedAt')}</dt><dd>{formatDateTime(x.resolved_at, lang)}</dd></>)}
            <dt>{t('tk.col.assigned')}</dt><dd>{x.assigned_to ? (x.assigned_to === admin?.id ? t('tk.me') : (admins.data?.find((a) => a.id === x.assigned_to)?.full_name ?? x.assigned_to)) : t('tk.unassigned')}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>{t('tk.body')}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{x.body}</p>
          {x.resolution_note && (
            <>
              <h2>{t('tk.resolution')}</h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{x.resolution_note}</p>
            </>
          )}
        </section>
      </div>

      <h2>{t('user.actions')}</h2>
      {notice && <p className={notice.ok ? 'ok' : 'error'}>{notice.text}</p>}
      <div className="actions">
        {transitions.map((s) => (
          <button key={s} type="button" className={s === 'resolved' ? '' : 'secondary'} disabled={run.isPending} onClick={() => go(s)}>
            {s === 'in_progress' && x.status === 'open' ? t('tkAction.take') : t(`tkAction.${s}`)}
          </button>
        ))}
        <label style={{ minWidth: 200 }}>
          {t('tkAction.assign')}
          <select value={x.assigned_to ?? ''} disabled={run.isPending || !admins.data} onChange={(e) => { setNotice(null); run.mutate({ assigned_to: e.target.value || null }) }}>
            <option value="">{t('tk.nobody')}</option>
            {(admins.data ?? []).filter((a) => a.status === 'active' || a.id === x.assigned_to).map((a) => (
              <option key={a.id} value={a.id}>{a.id === admin?.id ? `${a.full_name} (${t('tk.me')})` : `${a.full_name} · ${a.role}`}</option>
            ))}
          </select>
        </label>
        <label style={{ minWidth: 160 }}>
          {t('tkAction.priority')}
          <select value={x.priority} disabled={run.isPending} onChange={(e) => { setNotice(null); run.mutate({ priority: e.target.value as TicketPriority }) }}>
            {PRIORITIES.map((p) => (<option key={p} value={p}>{label(lang, 'prio', p)}</option>))}
          </select>
        </label>
      </div>
      {resolving && (
        <form className="card" style={{ marginTop: 12, maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); if (note.trim()) run.mutate({ status: 'resolved', resolution_note: note.trim() }) }}>
          <h2 style={{ marginTop: 0 }}>{t('tkAction.resolved')}</h2>
          <label>{t('tk.resolution')}<textarea value={note} rows={3} maxLength={5000} onChange={(e) => setNote(e.target.value)} required /><span className="muted">{t('tk.resolutionHint')}</span></label>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="submit" disabled={!note.trim() || run.isPending}>{t('action.confirm')}</button>
            <button type="button" className="secondary" onClick={() => setResolving(false)}>{t('action.cancel')}</button>
          </div>
        </form>
      )}
    </>
  )
}
