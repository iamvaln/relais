import type { AuditFilter } from '@relais/admin-core'
import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDateTime } from '../format'
import { label } from '../i18n'

/** Les codes du CHECK audit_logs.action (migrations init et 20260430). */
export const AUDIT_ACTIONS = [
  'ADMIN_LOGIN', 'ADMIN_CREATED',
  'ACCOUNT_UNBLOCK', 'ACCOUNT_SUSPEND', 'ACCOUNT_DELETE', 'OTP_REGEN', 'EMAIL_CHANGE', 'PHONE_CHANGE',
  'CONTACT_UNBLOCK', 'ESCROW_EXTEND', 'TRANSMISSION_CANCEL', 'TRANSMISSION_NOTIFY',
  'CONFIG_UPDATE', 'QUESTION_ADD', 'QUESTION_UPDATE', 'QUESTION_ARCHIVE',
  'SUBSCRIPTION_EXTEND', 'PLAN_CHANGE', 'TICKET_UPDATE',
] as const
const LIMIT = 50

export function auditFilterFromParams(p: URLSearchParams): AuditFilter {
  const page = Number.parseInt(p.get('page') ?? '1', 10)
  return {
    action: p.get('action') ?? '',
    admin_id: p.get('admin_id') ?? '',
    target_id: p.get('target_id') ?? '',
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: LIMIT,
  }
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">—</span>
  return <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 1)}</pre>
}

export function MonitoringScreen() {
  const { client, t, lang } = useApp()
  const [params, setParams] = useSearchParams()
  const filter = auditFilterFromParams(params)
  const health = useQuery({ queryKey: ['health'], queryFn: () => client.health(), refetchInterval: 60_000 })
  const audit = useQuery({ queryKey: ['audit', filter], queryFn: () => client.audit(filter), placeholderData: (prev) => prev })
  const [openRow, setOpenRow] = useState<string | null>(null)

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }
  const pages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.limit)) : 1
  const h = health.data
  const uptimeH = h ? Math.floor(h.uptime / 3600) : 0
  const uptimeM = h ? Math.floor((h.uptime % 3600) / 60) : 0

  return (
    <>
      <h1>{t('mon.title')}</h1>
      <h2>{t('mon.health')}</h2>
      {health.error && <p className="error">{t('common.error', { message: health.error.message })}</p>}
      {h && (
        <div className="grid">
          <section className="card">
            <dl className="dl">
              <dt>{t('users.col.status')}</dt><dd><span className={`badge ${h.status === 'ok' ? 'ok' : 'danger'}`}>{label(lang, 'service', h.status)}</span></dd>
              <dt>{t('mon.uptime')}</dt><dd>{t('mon.hours', { h: uptimeH, m: uptimeM })}</dd>
              <dt>{t('mon.jobs')}</dt><dd>{h.jobs.enabled ? t('mon.jobsOn') : t('mon.jobsOff')}</dd>
            </dl>
          </section>
          <section className="card">
            <div className="actions">
              {Object.entries(h.services).map(([name, status]) => (
                <span key={name} className={`badge ${status === 'ok' ? 'ok' : status === 'down' ? 'danger' : ''}`}>{name} · {label(lang, 'service', status)}</span>
              ))}
            </div>
          </section>
          {(['users', 'transmissions_open', 'escrows_active'] as const).map((k) => (
            <div className="kpi" key={k}>
              <div className="value">{h.counts[k]}</div>
              <div className="label">{t(`mon.counts.${k}`)}</div>
            </div>
          ))}
        </div>
      )}

      <h2>{t('mon.audit')}</h2>
      <p className="muted">{t('mon.auditHint')}</p>
      <div className="toolbar">
        <label>{t('mon.action')}
          <select value={filter.action ?? ''} onChange={(e) => set('action', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {AUDIT_ACTIONS.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </label>
        <label>{t('mon.admin')}<input value={filter.admin_id ?? ''} onChange={(e) => set('admin_id', e.target.value)} /></label>
        <label>{t('mon.target')}<input value={filter.target_id ?? ''} onChange={(e) => set('target_id', e.target.value)} /></label>
        <label>{t('mon.from')}<input type="date" value={filter.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label>{t('mon.to')}<input type="date" value={filter.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
      </div>
      {audit.error && <p className="error">{t('common.error', { message: audit.error.message })}</p>}
      {audit.data && (
        <>
          <p className="muted">{t('mon.count', { n: audit.data.total })}</p>
          {audit.data.items.length === 0 ? (
            <p>{t('mon.empty')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('mon.col.date')}</th>
                  <th>{t('mon.col.action')}</th>
                  <th>{t('mon.col.admin')}</th>
                  <th>{t('mon.col.target')}</th>
                  <th>{t('mon.col.reason')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td>{formatDateTime(l.created_at, lang)}</td>
                      <td><code>{l.action}</code></td>
                      <td className="muted">{l.admin_id ? l.admin_id.slice(0, 8) : '—'}</td>
                      <td className="muted">{l.target_type ? `${l.target_type} · ${l.target_id ?? ''}` : '—'}</td>
                      <td>{l.reason ?? '—'}</td>
                      <td>
                        {(l.value_before !== null || l.value_after !== null) && (
                          <button type="button" className="secondary" onClick={() => setOpenRow(openRow === l.id ? null : l.id)}>{t('mon.details')}</button>
                        )}
                      </td>
                    </tr>
                    {openRow === l.id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="grid">
                            <div><strong>{t('mon.before')}</strong><Json value={l.value_before} /></div>
                            <div><strong>{t('mon.after')}</strong><Json value={l.value_after} /></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          <div className="toolbar">
            <button type="button" className="secondary" disabled={(filter.page ?? 1) <= 1} onClick={() => set('page', String((filter.page ?? 1) - 1))}>{t('users.prev')}</button>
            <span className="muted">{t('users.page', { page: audit.data.page, pages })}</span>
            <button type="button" className="secondary" disabled={(filter.page ?? 1) >= pages} onClick={() => set('page', String((filter.page ?? 1) + 1))}>{t('users.next')}</button>
          </div>
        </>
      )}
    </>
  )
}
