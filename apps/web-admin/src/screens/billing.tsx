import { ApiError } from '@relais/api-client'
import { canAccess, type BillingOverview, type PlanChange, type SubscriptionStatus, type SubscriptionView, type SubscriptionsFilter, type UserPlan } from '@relais/admin-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDate, formatFcfa } from '../format'
import { label } from '../i18n'

const PLANS: UserPlan[] = ['free', 'premium']
const STATUSES: SubscriptionStatus[] = ['active', 'grace', 'expired', 'cancelled']
const LIMIT = 20
const KPI_ORDER: (keyof BillingOverview)[] = ['active_premium', 'in_grace', 'mrr_fcfa', 'arr_fcfa', 'renewals_this_month', 'churns_this_month', 'revenue_this_month_fcfa', 'revenue_total_fcfa', 'price_fcfa']
const FCFA = new Set<keyof BillingOverview>(['mrr_fcfa', 'arr_fcfa', 'revenue_this_month_fcfa', 'revenue_total_fcfa', 'price_fcfa'])
const STATUS_CLASS: Record<string, string> = { active: 'ok', grace: 'warn', expired: 'danger', cancelled: '' }

type Action = 'upgrade' | 'renew' | 'extend' | 'downgrade'

export function subscriptionsFilterFromParams(p: URLSearchParams): SubscriptionsFilter {
  const page = Number.parseInt(p.get('page') ?? '1', 10)
  return {
    search: p.get('search') ?? '',
    plan: (p.get('plan') as UserPlan | null) ?? '',
    status: (p.get('status') as SubscriptionStatus | null) ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: LIMIT,
  }
}

/** Ce que l'API permet (BO-07) : un gratuit passe premium ; un premium se renouvelle, se prolonge ou redescend ; un gratuit expiré peut aussi recevoir des jours. */
export function subscriptionActions(s: { plan: string; status: string }): Action[] {
  if (s.plan === 'premium') return ['renew', 'extend', 'downgrade']
  return s.status === 'active' ? ['upgrade'] : ['upgrade', 'extend']
}

/** Déclenche l'enregistrement d'un fichier texte dans le navigateur. */
export function saveTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function BillingScreen() {
  const { client, admin, t, lang } = useApp()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const filter = subscriptionsFilterFromParams(params)
  const overview = useQuery({ queryKey: ['billing', 'overview'], queryFn: () => client.billing.overview() })
  const subs = useQuery({ queryKey: ['billing', 'subscriptions', filter], queryFn: () => client.billing.subscriptions(filter), placeholderData: (prev) => prev })
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const [open, setOpen] = useState<{ action: Action; sub: SubscriptionView } | null>(null)
  const [amount, setAmount] = useState('')
  const [providerRef, setProviderRef] = useState('')
  const [days, setDays] = useState('30')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const fail = (err: Error) => {
    const message = err instanceof ApiError && err.code === 'AUTH_FORBIDDEN' ? t('common.forbidden') : err.message
    setNotice({ ok: false, text: t('action.error', { message }) })
  }
  const exportCsv = useMutation({
    mutationFn: () => client.billing.exportCsv(from, to),
    onSuccess: (file) => {
      saveTextFile(file.filename, file.csv)
      setNotice({ ok: true, text: t('action.done') })
    },
    onError: fail,
  })
  const run = useMutation({
    mutationFn: async (input: { action: Action; sub: SubscriptionView }): Promise<SubscriptionView> => {
      const { action, sub } = input
      if (action === 'extend') return client.billing.extend(sub.id, Number.parseInt(days, 10), reason.trim())
      const change: PlanChange = { plan: action === 'downgrade' ? 'free' : 'premium', reason: reason.trim() }
      if (action !== 'downgrade') {
        const n = Number.parseInt(amount, 10)
        if (Number.isFinite(n) && n > 0) change.amount_fcfa = n
        if (providerRef.trim()) change.provider_ref = providerRef.trim()
      }
      return client.billing.changePlan(sub.id, change)
    },
    onSuccess: () => {
      setOpen(null)
      setReason('')
      setProviderRef('')
      setNotice({ ok: true, text: t('action.done') })
      void qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: fail,
  })

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }
  const start = (action: Action, sub: SubscriptionView) => {
    setOpen({ action, sub })
    setAmount(String(overview.data?.price_fcfa ?? ''))
    setDays('30')
    setNotice(null)
  }
  const pages = subs.data ? Math.max(1, Math.ceil(subs.data.total / subs.data.limit)) : 1
  const daysN = Number.parseInt(days, 10)
  const canConfirm = open !== null && reason.trim().length > 0 && (open.action !== 'extend' || (daysN >= 1 && daysN <= 365))
  const seesUsers = admin ? canAccess(admin.role, 'users') : false

  return (
    <>
      <h1>{t('bill.title')}</h1>
      <p className="muted">{t('bill.manual')}</p>
      {overview.error && <p className="error">{t('common.error', { message: overview.error.message })}</p>}
      {overview.data && (
        <div className="grid">
          {KPI_ORDER.map((k) => (
            <div className="kpi" key={k}>
              <div className="value">{FCFA.has(k) ? formatFcfa(overview.data[k]) : String(overview.data[k])}</div>
              <div className="label">{t(`bill.kpi.${k}`)}</div>
            </div>
          ))}
        </div>
      )}

      <h2>{t('bill.export')}</h2>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); exportCsv.mutate() }}>
        <label>{t('bill.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
        <label>{t('bill.to')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} required /></label>
        <button type="submit" className="secondary" disabled={exportCsv.isPending}>{t('bill.download')}</button>
        <span className="muted">{t('bill.exportHint')}</span>
      </form>
      {notice && <p className={notice.ok ? 'ok' : 'error'}>{notice.text}</p>}

      <h2>{t('bill.subscriptions')}</h2>
      <div className="toolbar">
        <label className="grow">{t('bill.search')}<input value={filter.search ?? ''} onChange={(e) => set('search', e.target.value)} /></label>
        <label>{t('users.plan')}
          <select value={filter.plan ?? ''} onChange={(e) => set('plan', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {PLANS.map((p) => (<option key={p} value={p}>{label(lang, 'plan', p)}</option>))}
          </select>
        </label>
        <label>{t('users.status')}
          <select value={filter.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('users.any')}</option>
            {STATUSES.map((s) => (<option key={s} value={s}>{label(lang, 'status', s)}</option>))}
          </select>
        </label>
      </div>

      {open && (
        <form className="card" style={{ marginBottom: 14, maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); if (canConfirm) run.mutate(open) }}>
          <h2 style={{ marginTop: 0 }}>{t(`billAction.${open.action}`)} — {open.sub.full_name}</h2>
          {open.action === 'downgrade' && <p className="error">{t('billAction.downgradeHint')}</p>}
          {(open.action === 'upgrade' || open.action === 'renew') && (
            <>
              <label>{t('billAction.amount')}<input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label>{t('billAction.providerRef')}<input value={providerRef} maxLength={128} onChange={(e) => setProviderRef(e.target.value)} /></label>
            </>
          )}
          {open.action === 'extend' && <label>{t('billAction.days')}<input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} required /></label>}
          <label>{t('action.reason')}<textarea value={reason} rows={2} maxLength={500} onChange={(e) => setReason(e.target.value)} required /></label>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="submit" className={open.action === 'downgrade' ? 'danger' : ''} disabled={!canConfirm || run.isPending}>{t('action.confirm')}</button>
            <button type="button" className="secondary" onClick={() => setOpen(null)}>{t('action.cancel')}</button>
          </div>
        </form>
      )}

      {subs.error && <p className="error">{t('common.error', { message: subs.error.message })}</p>}
      {subs.data && (
        <>
          <p className="muted">{t('bill.count', { n: subs.data.total })}</p>
          {subs.data.items.length === 0 ? (
            <p>{t('bill.empty')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('bill.col.name')}</th>
                  <th>{t('users.col.plan')}</th>
                  <th>{t('users.col.status')}</th>
                  <th>{t('bill.col.expires')}</th>
                  <th>{t('bill.col.price')}</th>
                  <th>{t('bill.col.extensions')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {subs.data.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {seesUsers ? <Link to={`/users/${s.user_id}`}>{s.full_name}</Link> : s.full_name}
                      <div className="muted">{s.user_email}</div>
                    </td>
                    <td>{label(lang, 'plan', s.plan)}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[s.status] ?? ''}`}>{label(lang, 'status', s.status)}</span>
                      {s.grace_until && <div className="muted">{t('bill.col.grace')} {formatDate(s.grace_until, lang)}</div>}
                    </td>
                    <td>{formatDate(s.expires_at, lang)}</td>
                    <td>{s.price_fcfa === null ? '—' : formatFcfa(s.price_fcfa)}</td>
                    <td>{s.extended_count}</td>
                    <td>
                      <div className="actions">
                        {subscriptionActions(s).map((a) => (
                          <button key={a} type="button" className="secondary" onClick={() => start(a, s)}>{t(`billAction.${a}`)}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="toolbar">
            <button type="button" className="secondary" disabled={(filter.page ?? 1) <= 1} onClick={() => set('page', String((filter.page ?? 1) - 1))}>{t('users.prev')}</button>
            <span className="muted">{t('users.page', { page: subs.data.page, pages })}</span>
            <button type="button" className="secondary" disabled={(filter.page ?? 1) >= pages} onClick={() => set('page', String((filter.page ?? 1) + 1))}>{t('users.next')}</button>
          </div>
        </>
      )}
    </>
  )
}
