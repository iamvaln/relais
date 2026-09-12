// Mise en forme, en UTC pour être stable entre postes et en CI.
import type { Lang } from './i18n'

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const y = d.getUTCFullYear()
  const m = pad(d.getUTCMonth() + 1)
  const day = pad(d.getUTCDate())
  return lang === 'fr' ? `${day}/${m}/${y}` : `${y}-${m}-${day}`
}

export function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDate(iso, lang)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 10000 → « 10 000 FCFA » (espace entre les milliers). */
export function formatFcfa(amount: number): string {
  const s = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${s} FCFA`
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—'
  return `${Math.round(rate * 100)} %`
}
