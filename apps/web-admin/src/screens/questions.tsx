import { ApiError } from '@relais/api-client'
import { QUESTION_CATEGORIES, type QuestionCategory, type QuestionInput, type QuestionMode, type QuestionStatus, type QuestionUsage, type QuestionView, type QuestionsFilter } from '@relais/admin-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../app-state'
import { formatRate } from '../format'
import { label } from '../i18n'

const USAGES: QuestionUsage[] = ['secret_question', 'journal', 'both']
const STATUSES: QuestionStatus[] = ['active', 'review', 'archived']
const MODES: QuestionMode[] = ['all', 'essential', 'reflective']
const STATUS_CLASS: Record<string, string> = { active: 'ok', review: 'warn', archived: '' }

/** Statut « active » par défaut ; `status=all` dans l'URL retire le filtre. */
export function questionsFilterFromParams(p: URLSearchParams): QuestionsFilter {
  const status = p.get('status') ?? 'active'
  return {
    usage_type: (p.get('usage_type') as QuestionUsage | null) ?? '',
    status: status === 'all' ? '' : (status as QuestionStatus),
    category: (p.get('category') as QuestionCategory | null) ?? '',
  }
}

interface Draft {
  text_fr: string
  text_en: string
  category: QuestionCategory
  usage_type: QuestionUsage
  reliability_score: string
  risk_notes: string
  cycle_month: string
  mode_target: QuestionMode
  status: 'active' | 'review'
}

const EMPTY: Draft = { text_fr: '', text_en: '', category: 'childhood', usage_type: 'secret_question', reliability_score: '7', risk_notes: '', cycle_month: '', mode_target: 'all', status: 'active' }

function draftOf(q: QuestionView): Draft {
  return {
    text_fr: q.text_fr,
    text_en: q.text_en,
    category: q.category as QuestionCategory,
    usage_type: q.usage_type as QuestionUsage,
    reliability_score: String(q.reliability_score),
    risk_notes: q.risk_notes ?? '',
    cycle_month: q.cycle_month ? String(q.cycle_month) : '',
    mode_target: (q.mode_target as QuestionMode | null) ?? 'all',
    status: q.status === 'review' ? 'review' : 'active',
  }
}

function toInput(d: Draft): QuestionInput {
  const input: QuestionInput = {
    text_fr: d.text_fr.trim(),
    text_en: d.text_en.trim(),
    category: d.category,
    usage_type: d.usage_type,
    reliability_score: Number.parseInt(d.reliability_score, 10),
    mode_target: d.mode_target,
  }
  if (d.risk_notes.trim()) input.risk_notes = d.risk_notes.trim()
  if (d.cycle_month) input.cycle_month = Number.parseInt(d.cycle_month, 10)
  return input
}

export function QuestionsScreen() {
  const { client, t, lang } = useApp()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const filter = questionsFilterFromParams(params)
  const query = useQuery({ queryKey: ['questions', filter], queryFn: () => client.questions.list(filter), placeholderData: (prev) => prev })
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const fail = (err: Error) => {
    const message = err instanceof ApiError && err.code === 'QUESTION_DUPLICATE' ? t('q.duplicate') : err instanceof ApiError && err.code === 'AUTH_FORBIDDEN' ? t('common.forbidden') : err.message
    setNotice({ ok: false, text: t('action.error', { message }) })
  }
  const done = () => {
    setEditing(null)
    setArchiving(null)
    setReason('')
    setNotice({ ok: true, text: t('action.done') })
    void qc.invalidateQueries({ queryKey: ['questions'] })
  }
  const save = useMutation({
    mutationFn: async (e: { id: string | null; draft: Draft }) => {
      const input = toInput(e.draft)
      return e.id ? client.questions.update(e.id, { ...input, status: e.draft.status }) : client.questions.create(input)
    },
    onSuccess: done,
    onError: fail,
  })
  const archive = useMutation({ mutationFn: (id: string) => client.questions.archive(id, reason), onSuccess: done, onError: fail })

  const d = editing?.draft
  const patch = (p: Partial<Draft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...p } })
  const score = d ? Number.parseInt(d.reliability_score, 10) : 0
  const canSave = !!d && d.text_fr.trim().length >= 5 && d.text_en.trim().length >= 5 && score >= 1 && score <= 10

  return (
    <>
      <h1>{t('q.title')}</h1>
      <div className="toolbar">
        <label>
          {t('q.usage')}
          <select value={filter.usage_type ?? ''} onChange={(e) => set('usage_type', e.target.value)}>
            <option value="">{t('q.all')}</option>
            {USAGES.map((u) => (
              <option key={u} value={u}>{label(lang, 'usage', u)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('q.status')}
          <select value={filter.status === '' ? 'all' : filter.status} onChange={(e) => set('status', e.target.value)}>
            <option value="all">{t('q.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{label(lang, 'qstatus', s)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('q.category')}
          <select value={filter.category ?? ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">{t('q.all')}</option>
            {QUESTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>{label(lang, 'cat', c)}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => { setEditing({ id: null, draft: EMPTY }); setNotice(null) }}>{t('q.add')}</button>
      </div>
      {notice && <p className={notice.ok ? 'ok' : 'error'}>{notice.text}</p>}

      {editing && d && (
        <form className="card" style={{ marginBottom: 14, maxWidth: 720 }} onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(editing) }}>
          <h2 style={{ marginTop: 0 }}>{editing.id ? t('q.edit') : t('q.add')}</h2>
          <label>{t('q.textFr')}<textarea value={d.text_fr} rows={2} maxLength={500} onChange={(e) => patch({ text_fr: e.target.value })} required /></label>
          <label>{t('q.textEn')}<textarea value={d.text_en} rows={2} maxLength={500} onChange={(e) => patch({ text_en: e.target.value })} required /></label>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <label>{t('q.category')}
              <select value={d.category} onChange={(e) => patch({ category: e.target.value as QuestionCategory })}>
                {QUESTION_CATEGORIES.map((c) => (<option key={c} value={c}>{label(lang, 'cat', c)}</option>))}
              </select>
            </label>
            <label>{t('q.usage')}
              <select value={d.usage_type} onChange={(e) => patch({ usage_type: e.target.value as QuestionUsage })}>
                {USAGES.map((u) => (<option key={u} value={u}>{label(lang, 'usage', u)}</option>))}
              </select>
            </label>
            <label>{t('q.score')}<input type="number" min={1} max={10} value={d.reliability_score} onChange={(e) => patch({ reliability_score: e.target.value })} required /></label>
            <label>{t('q.cycleMonth')}
              <select value={d.cycle_month} onChange={(e) => patch({ cycle_month: e.target.value })}>
                <option value="">{t('q.noMonth')}</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </label>
            <label>{t('q.mode')}
              <select value={d.mode_target} onChange={(e) => patch({ mode_target: e.target.value as QuestionMode })}>
                {MODES.map((m) => (<option key={m} value={m}>{label(lang, 'mode', m)}</option>))}
              </select>
            </label>
            {editing.id && (
              <label>{t('q.status')}
                <select value={d.status} onChange={(e) => patch({ status: e.target.value === 'review' ? 'review' : 'active' })}>
                  <option value="active">{label(lang, 'qstatus', 'active')}</option>
                  <option value="review">{label(lang, 'qstatus', 'review')}</option>
                </select>
              </label>
            )}
          </div>
          <label>{t('q.risk')}<textarea value={d.risk_notes} rows={2} maxLength={2000} onChange={(e) => patch({ risk_notes: e.target.value })} /></label>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="submit" disabled={!canSave || save.isPending}>{t('q.save')}</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>{t('action.cancel')}</button>
          </div>
        </form>
      )}

      {archiving && (
        <form className="card" style={{ marginBottom: 14, maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); if (reason.trim()) archive.mutate(archiving) }}>
          <h2 style={{ marginTop: 0 }}>{t('q.archive')}</h2>
          <p className="muted">{t('q.archiveHint')}</p>
          <label>{t('action.reason')}<textarea value={reason} rows={2} maxLength={500} onChange={(e) => setReason(e.target.value)} required /></label>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="submit" className="danger" disabled={!reason.trim() || archive.isPending}>{t('action.confirm')}</button>
            <button type="button" className="secondary" onClick={() => setArchiving(null)}>{t('action.cancel')}</button>
          </div>
        </form>
      )}

      {query.error && <p className="error">{t('common.error', { message: query.error.message })}</p>}
      {query.data && (
        <>
          <p className="muted">{t('q.count', { n: query.data.length })}</p>
          {query.data.length === 0 ? (
            <p>{t('q.empty')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('q.col.fr')}</th>
                  <th>{t('q.col.en')}</th>
                  <th>{t('q.category')}</th>
                  <th>{t('q.usage')}</th>
                  <th>{t('q.col.score')}</th>
                  <th>{t('q.status')}</th>
                  <th>{t('q.col.uses')}</th>
                  <th>{t('q.col.failure')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.map((q) => (
                  <tr key={q.id}>
                    <td>{q.text_fr}</td>
                    <td>{q.text_en}</td>
                    <td>{label(lang, 'cat', q.category)}</td>
                    <td>{label(lang, 'usage', q.usage_type)}</td>
                    <td>{q.reliability_score}</td>
                    <td><span className={`badge ${STATUS_CLASS[q.status] ?? ''}`}>{label(lang, 'qstatus', q.status)}</span></td>
                    <td>{q.usage_count}</td>
                    <td>{formatRate(q.failure_rate)}</td>
                    <td>
                      <div className="actions">
                        <button type="button" className="secondary" onClick={() => { setEditing({ id: q.id, draft: draftOf(q) }); setArchiving(null); setNotice(null) }}>{t('common.edit')}</button>
                        {q.status !== 'archived' && (
                          <button type="button" className="secondary" onClick={() => { setArchiving(q.id); setEditing(null); setNotice(null) }}>{t('q.archive')}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  )
}
