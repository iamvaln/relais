// Carnet de vie et Wrapped (E2-US07, DEC-31/32). Les entrées sont des blobs
// sous K2 chez Relais, déchiffrés à la lecture sur le device (décision du
// 12/09/2026 : pas de cache local). Chaque écriture est signée par la clé
// de l'owner ; le Wrapped est calculé ici, puis déposé chiffré et signé.

import type { ApiClient } from '@relais/api-client'
import { type CategoryKeys, type EntryClear, type JournalMode, type SigningKeypair, buildDeleteSignature, buildEntryPayload, buildWrappedPayload, fromBase64, open, wipe } from '@relais/crypto-core'

export type { EntryClear, JournalMode }

export interface JournalQuestion {
  id: string
  text_fr: string
  text_en: string
  category: string
}

export interface MonthQuestion {
  month: string
  mode: JournalMode
  question: JournalQuestion | null
  answered: boolean
}

export interface JournalEntry {
  id: string
  month: string
  mode: string
  question_id: string | null
  word_count_approx: number | null
  created_at: string
  updated_at: string
}

export interface JournalEntryDetail extends JournalEntry {
  content_enc: string
}

export interface WrappedStats {
  year: number
  entries: number
  words: number
  modes: Record<JournalMode, number>
  months: string[]
  longest: { month: string; words: number } | null
}

export interface WrappedView {
  year: number
  entry_count: number
  stats_enc: string
  exported: boolean
  exported_at: string | null
  generated_at: string
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Premier jour du mois courant (UTC), la clé d'une entrée. */
export function currentMonth(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

/** DEC-32 : les statistiques d'une année, calculées sur le device à partir des entrées déchiffrées. */
export function wrappedStats(year: number, entries: EntryClear[]): WrappedStats {
  const sorted = [...entries].sort((a, b) => a.entry_month.localeCompare(b.entry_month))
  const modes: Record<JournalMode, number> = { essential: 0, reflective: 0, free: 0 }
  let words = 0
  let longest: WrappedStats['longest'] = null
  for (const e of sorted) {
    const n = wordCount(e.texte)
    words += n
    modes[e.mode]++
    if (!longest || n > longest.words) longest = { month: e.entry_month, words: n }
  }
  return { year, entries: sorted.length, words, modes, months: sorted.map((e) => e.entry_month), longest }
}

export interface JournalDeps {
  api: ApiClient
  keys: () => CategoryKeys
  signer: () => SigningKeypair
}

export class Journal {
  constructor(private readonly deps: JournalDeps) {}

  question(mode: JournalMode = 'essential'): Promise<MonthQuestion> {
    return this.deps.api.get(`/journal/question?mode=${mode}`)
  }

  entries(): Promise<JournalEntry[]> {
    return this.deps.api.get('/journal/entries')
  }

  private async decrypt(detail: JournalEntryDetail): Promise<{ entry: JournalEntry; clear: EntryClear }> {
    const clear = await open(this.deps.keys().k2, fromBase64(detail.content_enc))
    try {
      const entry: JournalEntry = { id: detail.id, month: detail.month, mode: detail.mode, question_id: detail.question_id, word_count_approx: detail.word_count_approx, created_at: detail.created_at, updated_at: detail.updated_at }
      return { entry, clear: JSON.parse(Buffer.from(clear).toString('utf8')) as EntryClear }
    } finally {
      wipe(clear)
    }
  }

  async read(id: string): Promise<{ entry: JournalEntry; clear: EntryClear }> {
    return this.decrypt(await this.deps.api.get<JournalEntryDetail>(`/journal/entries/${id}`))
  }

  /** L'entrée d'un mois (YYYY-MM), ou null. */
  async readMonth(ym: string): Promise<{ entry: JournalEntry; clear: EntryClear } | null> {
    try {
      return await this.decrypt(await this.deps.api.get<JournalEntryDetail>(`/journal/entries/month/${ym}`))
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null
      throw err
    }
  }

  /** Une entrée par mois : la seconde écriture du même mois remplace la première (409 JOURNAL_MONTH_TAKEN → PUT). */
  async save(input: { month?: string; mode: JournalMode; questionId: string | null; texte: string }): Promise<JournalEntry> {
    const clear: EntryClear = { question_id: input.questionId, entry_month: input.month ?? currentMonth(), mode: input.mode, texte: input.texte }
    const payload = await buildEntryPayload(this.deps.keys().k2, clear, this.deps.signer().privateKey, { word_count_approx: wordCount(input.texte) })
    try {
      return await this.deps.api.post<JournalEntry>('/journal/entries', payload)
    } catch (err) {
      const e = err as { code?: string; details?: { id?: string } }
      if (e.code !== 'JOURNAL_MONTH_TAKEN' || !e.details?.id) throw err
      const update = { content_enc: payload.content_enc, signature: payload.signature, mode: payload.mode, ...(payload.question_id ? { question_id: payload.question_id } : {}), ...(payload.word_count_approx !== undefined ? { word_count_approx: payload.word_count_approx } : {}) }
      return this.deps.api.put<JournalEntry>(`/journal/entries/${e.details.id}`, update)
    }
  }

  async remove(id: string): Promise<void> {
    await this.deps.api.delete(`/journal/entries/${id}`, await buildDeleteSignature(id, this.deps.signer().privateKey))
  }

  /** Les entrées déchiffrées d'une année, par mois croissant. */
  async yearEntries(year: number): Promise<EntryClear[]> {
    const all = await this.entries()
    const clears: EntryClear[] = []
    for (const e of all.filter((e) => e.month.startsWith(`${year}-`))) clears.push((await this.read(e.id)).clear)
    return clears
  }

  /** Calcule le Wrapped ici et le dépose chiffré et signé ; le serveur recompte les entrées (DEC-32). */
  async buildWrapped(year: number): Promise<{ view: WrappedView; stats: WrappedStats }> {
    const stats = wrappedStats(year, await this.yearEntries(year))
    const body = await buildWrappedPayload(this.deps.keys().k2, stats, this.deps.signer().privateKey)
    const view = await this.deps.api.post<WrappedView>(`/journal/wrapped/${year}`, body)
    return { view, stats }
  }

  async wrapped(year: number): Promise<{ view: WrappedView; stats: WrappedStats } | null> {
    let view: WrappedView
    try {
      view = await this.deps.api.get<WrappedView>(`/journal/wrapped/${year}`)
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null
      throw err
    }
    const clear = await open(this.deps.keys().k2, fromBase64(view.stats_enc))
    try {
      return { view, stats: JSON.parse(Buffer.from(clear).toString('utf8')) as WrappedStats }
    } finally {
      wipe(clear)
    }
  }

  markExported(year: number): Promise<WrappedView> {
    return this.deps.api.post(`/journal/wrapped/${year}/export`)
  }
}
