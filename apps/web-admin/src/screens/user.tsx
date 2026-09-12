import { ApiError } from '@relais/api-client'
import { canAccess, type UserDetailView } from '@relais/admin-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatDate, formatDateTime } from '../format'
import { label } from '../i18n'

type Action = 'unblock' | 'otp' | 'suspend' | 'email' | 'delete'

/** Qui peut quoi (grille BO-02) : support débloque et regénère ; admin suspend et change l'email ; super_admin supprime. */
export function allowedActions(role: string): Action[] {
  const out: Action[] = []
  if (canAccess(role, 'users')) out.push('unblock', 'otp')
  if (role === 'admin' || role === 'super_admin') out.push('suspend', 'email')
  if (role === 'super_admin') out.push('delete')
  return out
}

export function UserScreen() {
  const { client, admin, t, lang } = useApp()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useQuery({ queryKey: ['user', id], queryFn: () => client.users.get(id), enabled: id.length > 0 })
  const [open, setOpen] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const run = useMutation({
    mutationFn: async (action: Action): Promise<UserDetailView | null> => {
      switch (action) {
        case 'unblock':
          return client.users.unblock(id, reason)
        case 'otp':
          await client.users.regenerateOtp(user.data?.email ?? '')
          return null
        case 'suspend':
          return client.users.suspend(id, reason)
        case 'email':
          return client.users.changeEmail(id, newEmail.trim(), reason)
        case 'delete':
          await client.users.remove(id, reason)
          return null
      }
    },
    onSuccess: (data, action) => {
      setOpen(null)
      setReason('')
      setNewEmail('')
      setConfirmWord('')
      setNotice({ ok: true, text: action === 'otp' ? t('action.otpSent') : t('action.done') })
      if (action === 'delete') {
        void qc.invalidateQueries({ queryKey: ['users'] })
        navigate('/users')
        return
      }
      if (data) qc.setQueryData(['user', id], data)
      void qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => {
      const message = err instanceof ApiError && err.code === 'AUTH_FORBIDDEN' ? t('common.forbidden') : err.message
      setNotice({ ok: false, text: t('action.error', { message }) })
    },
  })

  if (user.isPending) return <p className="muted">{t('common.loading')}</p>
  if (user.error || !user.data) return <p className="error">{t('common.error', { message: user.error?.message ?? '' })}</p>
  const u = user.data
  const actions = admin ? allowedActions(admin.role) : []
  const needsReason = open !== null && open !== 'otp'
  const canConfirm =
    open !== null &&
    (!needsReason || reason.trim().length > 0) &&
    (open !== 'email' || newEmail.includes('@')) &&
    (open !== 'delete' || confirmWord === t('action.deleteWord'))

  return (
    <>
      <p>
        <Link to="/users">{t('user.back')}</Link>
      </p>
      <h1>
        {u.full_name} <span className={`badge ${u.account_status === 'active' ? 'ok' : u.account_status === 'suspended' ? 'danger' : ''}`}>{label(lang, 'status', u.account_status)}</span>
      </h1>
      <p className="muted">{t('user.zeroKnowledge')}</p>
      <div className="grid">
        <section className="card">
          <h2>{t('user.identity')}</h2>
          <dl className="dl">
            <dt>{t('users.col.email')}</dt><dd>{u.email}</dd>
            <dt>{t('user.phone')}</dt><dd>{u.phone ?? '—'}</dd>
            <dt>{t('user.language')}</dt><dd>{u.language}</dd>
            <dt>{t('users.col.created')}</dt><dd>{formatDateTime(u.created_at, lang)}</dd>
            {u.deleted_at && (<><dt>{t('user.deletedAt')}</dt><dd>{formatDateTime(u.deleted_at, lang)}</dd></>)}
          </dl>
        </section>
        <section className="card">
          <h2>{t('user.subscription')}</h2>
          <dl className="dl">
            <dt>{t('users.col.plan')}</dt><dd>{label(lang, 'plan', u.subscription?.plan ?? u.plan)}</dd>
            <dt>{t('users.col.status')}</dt><dd>{u.subscription ? label(lang, 'status', u.subscription.status) : '—'}</dd>
            <dt>{t('user.expires')}</dt><dd>{formatDate(u.subscription?.expires_at ?? null, lang)}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>{t('user.transmission')}</h2>
          <dl className="dl">
            <dt>{t('users.col.status')}</dt><dd>{label(lang, 'tx', u.transmission_status)}</dd>
            <dt>{t('users.col.lastCheckin')}</dt><dd>{formatDateTime(u.last_checkin_at, lang)}</dd>
            <dt>{t('user.checkins')}</dt><dd>{u.checkins}</dd>
            <dt>{t('user.journal')}</dt><dd>{u.journal_entries}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>{t('user.security')}</h2>
          <dl className="dl">
            <dt>{t('user.totp')}</dt><dd>{u.totp_enabled ? t('common.yes') : t('common.no')}</dd>
            <dt>{t('user.failCount')}</dt><dd>{u.login_fail_count}</dd>
            <dt>{t('user.lockedUntil')}</dt><dd>{formatDateTime(u.login_locked_until, lang)}</dd>
            <dt>{t('user.sessions')}</dt><dd>{u.sessions}</dd>
          </dl>
        </section>
      </div>

      <h2>{t('user.actions')}</h2>
      {notice && <p className={notice.ok ? 'ok' : 'error'}>{notice.text}</p>}
      <div className="actions">
        {actions.map((a) => (
          <button key={a} type="button" className={a === 'delete' ? 'danger' : 'secondary'} disabled={u.account_status === 'deleted'} onClick={() => { setOpen(a); setNotice(null) }}>
            {t(`action.${a}`)}
          </button>
        ))}
      </div>
      {open && (
        <form className="card" style={{ marginTop: 12, maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); if (canConfirm) run.mutate(open) }}>
          <h2 style={{ marginTop: 0 }}>{t(`action.${open}`)}</h2>
          {open === 'delete' && <p className="error">{t('action.deleteConfirm')}</p>}
          {open === 'email' && (
            <label>
              {t('action.newEmail')}
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
            </label>
          )}
          {needsReason && (
            <label>
              {t('action.reason')}
              <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} required />
            </label>
          )}
          {open === 'delete' && <input value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} placeholder={t('action.deleteWord')} />}
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="submit" className={open === 'delete' ? 'danger' : ''} disabled={!canConfirm || run.isPending}>
              {t('action.confirm')}
            </button>
            <button type="button" className="secondary" onClick={() => setOpen(null)}>
              {t('action.cancel')}
            </button>
          </div>
        </form>
      )}
    </>
  )
}
