import { ApiError } from '@relais/api-client'
import { configChangeConfirmed, formatConfigValue, parseConfigValue, type ConfigView } from '@relais/admin-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApp } from '../app-state'
import { formatDateTime } from '../format'
import type { Key } from '../i18n'

const CATEGORIES = ['dms', 'security', 'vault', 'notifications', 'billing'] as const

export function ConfigScreen() {
  const { client, t, lang } = useApp()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['config'], queryFn: () => client.config.list() })
  const [editing, setEditing] = useState<ConfigView | null>(null)
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [typedKey, setTypedKey] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const save = useMutation({
    mutationFn: (c: ConfigView) => {
      const parsed = parseConfigValue(c.config_type, text)
      if (!parsed.ok) throw new Error(t('cfg.invalid', { type: c.config_type }))
      return client.config.update(c.key, parsed.value, reason.trim())
    },
    onSuccess: () => {
      setEditing(null)
      setNotice({ ok: true, text: t('action.done') })
      void qc.invalidateQueries({ queryKey: ['config'] })
    },
    onError: (err) => {
      const message = err instanceof ApiError && err.code === 'AUTH_FORBIDDEN' ? t('common.forbidden') : err.message
      setNotice({ ok: false, text: t('action.error', { message }) })
    },
  })

  const start = (c: ConfigView) => {
    setEditing(c)
    setText(formatConfigValue(c.config_type, c.value))
    setReason('')
    setTypedKey('')
    setNotice(null)
  }
  const parsed = editing ? parseConfigValue(editing.config_type, text) : null
  const canConfirm = !!editing && !!parsed?.ok && configChangeConfirmed({ key: editing.key, typedKey, reason })
  const rows = query.data ?? []

  return (
    <>
      <h1>{t('cfg.title')}</h1>
      <p className="muted">{t('cfg.hint')}</p>
      {notice && <p className={notice.ok ? 'ok' : 'error'}>{notice.text}</p>}
      {query.error && <p className="error">{t('common.error', { message: query.error.message })}</p>}
      {editing && (
        <form className="card" style={{ marginBottom: 14, maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); if (canConfirm) save.mutate(editing) }}>
          <h2 style={{ marginTop: 0 }}>{t('cfg.editing', { key: editing.key })}</h2>
          <p className="muted">{editing.description}</p>
          <label>
            {t('cfg.value')}
            <input value={text} onChange={(e) => setText(e.target.value)} required />
            <span className={parsed && !parsed.ok ? 'error' : 'muted'}>{parsed && !parsed.ok ? t('cfg.invalid', { type: editing.config_type }) : t(`cfg.hint.${editing.config_type}` as Key)}</span>
          </label>
          <label>
            {t('action.reason')}
            <textarea value={reason} rows={2} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
          </label>
          <label>
            {t('cfg.confirmKey')}
            <input value={typedKey} onChange={(e) => setTypedKey(e.target.value)} placeholder={editing.key} autoComplete="off" />
          </label>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="submit" disabled={!canConfirm || save.isPending}>{t('action.confirm')}</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>{t('action.cancel')}</button>
          </div>
        </form>
      )}
      {CATEGORIES.filter((cat) => rows.some((r) => r.category === cat)).map((cat) => (
        <section key={cat}>
          <h2>{t(`cfg.category.${cat}`)}</h2>
          <table>
            <thead>
              <tr>
                <th>{t('cfg.col.key')}</th>
                <th>{t('cfg.col.description')}</th>
                <th>{t('cfg.col.value')}</th>
                <th>{t('cfg.col.type')}</th>
                <th>{t('cfg.col.updated')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.category === cat).map((r) => (
                <tr key={r.key}>
                  <td><code>{r.key}</code></td>
                  <td>{r.description}</td>
                  <td><strong>{formatConfigValue(r.config_type, r.value)}</strong></td>
                  <td className="muted">{r.config_type}</td>
                  <td>{r.updated_by ? formatDateTime(r.updated_at, lang) : t('cfg.never')}</td>
                  <td><button type="button" className="secondary" onClick={() => start(r)}>{t('cfg.edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}
