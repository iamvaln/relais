import { ApiError } from '@relais/api-client'
import { canAccess, type TransmissionDetailView } from '@relais/admin-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDateTime } from '../format'
import { label } from '../i18n'
import { RUN_CLASS, unlockedLabel } from './transmissions'

type Action = 'extend' | 'notify' | 'cancel' | 'unblock'
const OPEN = ['triggered', 'in_progress']

/** Grille BO-03 : support débloque un contact ; admin étend l'escrow et relance ; super_admin annule. */
export function allowedTransmissionActions(role: string): Action[] {
  const out: Action[] = []
  if (role === 'admin' || role === 'super_admin') out.push('extend', 'notify')
  if (role === 'super_admin') out.push('cancel')
  if (canAccess(role, 'transmissions')) out.push('unblock')
  return out
}

export function TransmissionScreen() {
  const { client, admin, t, lang } = useApp()
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const tx = useQuery({ queryKey: ['transmission', id], queryFn: () => client.transmissions.get(id), enabled: id.length > 0 })
  const [open, setOpen] = useState<{ action: Action; contactId?: string } | null>(null)
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState<24 | 48>(24)
  const [confirmWord, setConfirmWord] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const run = useMutation({
    mutationFn: async (input: { action: Action; contactId?: string }): Promise<{ detail?: TransmissionDetailView; notified?: number }> => {
      switch (input.action) {
        case 'extend':
          return { detail: await client.transmissions.extendEscrow(id, hours, reason) }
        case 'notify':
          return { notified: (await client.transmissions.notify(id, reason)).notified }
        case 'cancel':
          return { detail: await client.transmissions.cancel(id, reason) }
        case 'unblock':
          await client.transmissions.unblockContact(id, input.contactId ?? '', reason)
          return {}
      }
    },
    onSuccess: (data) => {
      setOpen(null)
      setReason('')
      setConfirmWord('')
      setNotice({ ok: true, text: data.notified !== undefined ? t('trsAction.notified', { n: data.notified }) : t('action.done') })
      if (data.detail) qc.setQueryData(['transmission', id], data.detail)
      else void qc.invalidateQueries({ queryKey: ['transmission', id] })
      void qc.invalidateQueries({ queryKey: ['transmissions'] })
    },
    onError: (err) => {
      const message = err instanceof ApiError && err.code === 'AUTH_FORBIDDEN' ? t('common.forbidden') : err.message
      setNotice({ ok: false, text: t('action.error', { message }) })
    },
  })

  if (tx.isPending) return <p className="muted">{t('common.loading')}</p>
  if (tx.error || !tx.data) return <p className="error">{t('common.error', { message: tx.error?.message ?? '' })}</p>
  const x = tx.data
  const actions = admin ? allowedTransmissionActions(admin.role) : []
  const isOpen = OPEN.includes(x.status)
  const canConfirm = open !== null && reason.trim().length > 0 && (open.action !== 'cancel' || confirmWord === t('trsAction.cancelWord'))
  const start = (action: Action, contactId?: string) => {
    setOpen(contactId ? { action, contactId } : { action })
    setNotice(null)
  }

  return (
    <>
      <p>
        <Link to="/transmissions">{t('trs.back')}</Link>
      </p>
      <h1>
        {t('trs.detail')} <span className={`badge ${RUN_CLASS[x.status] ?? ''}`}>{label(lang, 'run', x.status)}</span>
      </h1>
      <p className="muted">{t('trs.zeroKnowledge')}</p>
      <div className="grid">
        <section className="card">
          <h2>{t('trs.overview')}</h2>
          <dl className="dl">
            <dt>{t('trs.owner')}</dt><dd><Link to={`/users/${x.user_id}`}>{t('trs.ownerLink')}</Link></dd>
            <dt>{t('trs.col.triggered')}</dt><dd>{formatDateTime(x.triggered_at, lang)}</dd>
            <dt>{t('trs.col.schema')}</dt><dd>{x.schema.n}/{x.schema.m}</dd>
            <dt>{t('trs.col.contacts')}</dt><dd>{x.contacts_confirmed}/{x.contacts_notified}</dd>
            <dt>{t('trs.col.unlocked')}</dt><dd>{unlockedLabel(x.unlocked)}</dd>
            {x.completed_at && (<><dt>{t('trs.completedAt')}</dt><dd>{formatDateTime(x.completed_at, lang)}</dd></>)}
            {x.cancelled_at && (<><dt>{t('trs.cancelledAt')}</dt><dd>{formatDateTime(x.cancelled_at, lang)}</dd></>)}
            {x.cancellation_reason && (<><dt>{t('trs.cancellationReason')}</dt><dd>{x.cancellation_reason}</dd></>)}
          </dl>
        </section>
        <section className="card">
          <h2>{t('trs.col.escrow')}</h2>
          <dl className="dl">
            <dt>{t('trs.escrowExpires')}</dt><dd>{formatDateTime(x.escrow_expires_at, lang)}</dd>
            <dt>{t('trs.col.escrow')}</dt><dd>{x.escrow_active ? t('trs.hoursLeft', { h: Math.floor(x.escrow_ttl_seconds / 3600) }) : t('trs.escrowExpired')}</dd>
            <dt>{t('trs.col.extensions')}</dt><dd>{x.escrow_extended_count}</dd>
          </dl>
        </section>
      </div>

      <h2>{t('trs.contacts')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('trs.col.status')}</th>
            <th>{t('trs.col.roles')}</th>
            <th>{t('trs.col.fails')}</th>
            <th>{t('trs.col.notified')}</th>
            <th>{t('trs.col.answered')}</th>
            <th>{t('trs.col.confirmed')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {x.contacts.map((c) => (
            <tr key={c.id}>
              <td>
                <span className={`badge ${c.blocked ? 'danger' : c.status === 'confirmed' || c.status === 'answered' ? 'ok' : ''}`}>{label(lang, 'cstatus', c.status)}</span>
                {c.blocked && <span className="muted"> · {t('trs.blocked')}</span>}
              </td>
              <td>{unlockedLabel(c.roles)}</td>
              <td>{c.fail_count}</td>
              <td>{formatDateTime(c.notified_at, lang)}</td>
              <td>{formatDateTime(c.answered_at, lang)}</td>
              <td>{formatDateTime(c.confirmed_at, lang)}</td>
              <td>
                {c.blocked && actions.includes('unblock') && (
                  <button type="button" className="secondary" onClick={() => start('unblock', c.id)}>{t('trsAction.unblock')}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t('user.actions')}</h2>
      {notice && <p className={notice.ok ? 'ok' : 'error'}>{notice.text}</p>}
      {!isOpen && <p className="muted">{t('trs.closed', { status: label(lang, 'run', x.status) })}</p>}
      <div className="actions">
        {actions.filter((a) => a !== 'unblock').map((a) => (
          <button key={a} type="button" className={a === 'cancel' ? 'danger' : 'secondary'} disabled={!isOpen} onClick={() => start(a)}>
            {t(`trsAction.${a}`)}
          </button>
        ))}
      </div>
      {open && (
        <form className="card" style={{ marginTop: 12, maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); if (canConfirm) run.mutate(open) }}>
          <h2 style={{ marginTop: 0 }}>{t(`trsAction.${open.action}`)}</h2>
          {open.action === 'cancel' && <p className="error">{t('trsAction.cancelConfirm')}</p>}
          {open.action === 'notify' && <p className="muted">{t('trsAction.notifyHint')}</p>}
          {open.action === 'extend' && (
            <label>
              {t('trsAction.hours')}
              <select value={hours} onChange={(e) => setHours(e.target.value === '48' ? 48 : 24)}>
                {[24, 48].map((h) => (
                  <option key={h} value={h}>{t('trsAction.hoursValue', { h })}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t('action.reason')}
            <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} required />
          </label>
          {open.action === 'cancel' && <input value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} placeholder={t('trsAction.cancelWord')} />}
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="submit" className={open.action === 'cancel' ? 'danger' : ''} disabled={!canConfirm || run.isPending}>
              {t('action.confirm')}
            </button>
            <button type="button" className="secondary" onClick={() => setOpen(null)}>
              {t('action.cancel')}
            </button>
          </div>
        </form>
      )}

      <h2>{t('trs.audit')}</h2>
      {x.audit.length === 0 ? (
        <p className="muted">{t('trs.noAudit')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('trs.col.date')}</th>
              <th>{t('trs.col.action')}</th>
              <th>{t('trs.col.admin')}</th>
              <th>{t('trs.col.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {x.audit.map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.created_at, lang)}</td>
                <td>{l.action}</td>
                <td className="muted">{l.admin_id ?? '—'}</td>
                <td>{l.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
