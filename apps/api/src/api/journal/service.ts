// Carnet de vie (Backend Specs §3.6, Techniques §10, E2-US07).
//
// Le contenu est chiffré K2 sur le device (content_enc) : le serveur ne
// garde que des métadonnées lisibles (mois, mode, question, taille
// approximative) et le blob. Une entrée par mois calendaire.

import { createHash } from 'node:crypto'
import { decodeBase64, ed25519Verify } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { monthOf } from '../checkin/service.js'
import type { EntryBody, EntryUpdateBody, JournalMode, WrappedBody } from './schemas.js'

// --- Question du mois -------------------------------------------------------------

export interface QuestionView {
  id: string
  text_fr: string
  text_en: string
  category: string
}

export interface MonthQuestionView {
  month: string
  mode: JournalMode
  question: QuestionView | null
  answered: boolean
}

/** Cycle annuel : une question par mois et par mode ; le mode libre n'en propose pas. */
export async function getQuestion(userId: string, mode: JournalMode = 'essential', now = new Date()): Promise<MonthQuestionView> {
  const month = monthOf(now)
  const question =
    mode === 'free'
      ? null
      : await prisma().checkin_questions.findFirst({
          where: { usage_type: 'journal', status: 'active', cycle_month: month.getUTCMonth() + 1, mode_target: mode },
          orderBy: { created_at: 'asc' },
          select: { id: true, text_fr: true, text_en: true, category: true },
        })
  const answered = await prisma().journal_entries.findUnique({
    where: { user_id_entry_month: { user_id: userId, entry_month: month } },
    select: { id: true },
  })
  return { month: month.toISOString().slice(0, 10), mode, question, answered: answered !== null }
}

// --- Entrées ----------------------------------------------------------------------

export interface EntryView {
  id: string
  month: string
  mode: string
  question_id: string | null
  word_count_approx: number | null
  created_at: string
  updated_at: string
}

export interface EntryDetailView extends EntryView {
  content_enc: string
}

const entrySelect = {
  id: true,
  entry_month: true,
  mode: true,
  question_id: true,
  word_count_approx: true,
  created_at: true,
  updated_at: true,
} as const

type EntryRow = {
  id: string
  entry_month: Date
  mode: string
  question_id: string | null
  word_count_approx: number | null
  created_at: Date
  updated_at: Date
}

function toView(r: EntryRow): EntryView {
  return {
    id: r.id,
    month: r.entry_month.toISOString().slice(0, 10),
    mode: r.mode,
    question_id: r.question_id,
    word_count_approx: r.word_count_approx,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }
}

// --- DEC-31 : chaque écriture est signée par la clé de l'owner --------------------

async function ownerPk(userId: string): Promise<Buffer> {
  const user = await prisma().users.findUnique({ where: { id: userId }, select: { ed25519_pk: true } })
  if (!user) throw new AppError('NOT_FOUND')
  if (!user.ed25519_pk) throw new AppError('AUTH_KEY_NOT_SET')
  return Buffer.from(user.ed25519_pk)
}

function decodeOrThrow(field: string, value: string): Uint8Array<ArrayBuffer> {
  const bytes = decodeBase64(value)
  if (!bytes || bytes.length === 0) throw new AppError('VALIDATION_ERROR', { details: { [field]: 'base64 invalide ou vide' } })
  return new Uint8Array(bytes)
}

/** Signature Ed25519 sur SHA256(message), comme pour le vault (DEC-07). */
async function requireSignature(userId: string, message: Buffer, signatureB64: string, what: string): Promise<void> {
  const pk = await ownerPk(userId)
  const sig = decodeOrThrow('signature', signatureB64)
  if (!ed25519Verify(pk, createHash('sha256').update(message).digest(), Buffer.from(sig))) {
    throw new AppError('AUTH_TOKEN_INVALID', { message: `Signature ${what} invalide.` })
  }
}

// --- Règles ------------------------------------------------------------------------

function parseMonth(value: string | undefined, now: Date): Date {
  if (value === undefined) return monthOf(now)
  const month = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(month.getTime())) throw new AppError('VALIDATION_ERROR', { details: { entry_month: 'date invalide' } })
  if (month > monthOf(now)) throw new AppError('VALIDATION_ERROR', { details: { entry_month: 'un mois futur ne se raconte pas encore' } })
  return month
}

/** Une question de carnet : usage_type journal ou both, active. */
async function validateQuestion(questionId: string | undefined): Promise<void> {
  if (questionId === undefined) return
  const q = await prisma().checkin_questions.findUnique({ where: { id: questionId }, select: { usage_type: true, status: true } })
  if (!q || q.status !== 'active' || q.usage_type === 'secret_question') {
    throw new AppError('VALIDATION_ERROR', { details: { question_id: 'question de carnet introuvable' } })
  }
}

async function ownEntry(userId: string, id: string) {
  const e = await prisma().journal_entries.findFirst({ where: { id, user_id: userId }, select: { id: true, entry_month: true } })
  if (!e) throw new AppError('NOT_FOUND', { message: 'Entrée introuvable.' })
  return e
}

// --- CRUD ----------------------------------------------------------------------------

export async function createEntry(userId: string, body: EntryBody, now = new Date()): Promise<EntryView> {
  const contentEnc = decodeOrThrow('content_enc', body.content_enc)
  await requireSignature(userId, Buffer.from(contentEnc), body.signature, 'du contenu')
  const month = parseMonth(body.entry_month, now)
  await validateQuestion(body.question_id)

  const taken = await prisma().journal_entries.findUnique({
    where: { user_id_entry_month: { user_id: userId, entry_month: month } },
    select: { id: true },
  })
  if (taken) throw new AppError('JOURNAL_MONTH_TAKEN', { details: { id: taken.id } })

  // Fix-09a : le check-in du mois, s'il existe déjà, se rattache à l'entrée.
  const row = await prisma().$transaction(async (tx) => {
    const created = await tx.journal_entries.create({
      data: {
        user_id: userId,
        entry_month: month,
        mode: body.mode,
        question_id: body.question_id ?? null,
        content_enc: contentEnc,
        word_count_approx: body.word_count_approx ?? null,
      },
      select: entrySelect,
    })
    await tx.checkin_log.updateMany({
      where: { user_id: userId, checkin_month: month, journal_entry_id: null },
      data: { journal_entry_id: created.id },
    })
    return created
  })
  return toView(row)
}

export async function listEntries(userId: string, limit = 60): Promise<EntryView[]> {
  const rows = await prisma().journal_entries.findMany({ where: { user_id: userId }, orderBy: { entry_month: 'desc' }, take: limit, select: entrySelect })
  return rows.map(toView)
}

export async function getEntry(userId: string, id: string): Promise<EntryDetailView> {
  const row = await prisma().journal_entries.findFirst({ where: { id, user_id: userId }, select: { ...entrySelect, content_enc: true } })
  if (!row) throw new AppError('NOT_FOUND', { message: 'Entrée introuvable.' })
  return { ...toView(row), content_enc: Buffer.from(row.content_enc).toString('base64') }
}

export async function updateEntry(userId: string, id: string, body: EntryUpdateBody): Promise<EntryView> {
  await ownEntry(userId, id)
  const contentEnc = decodeOrThrow('content_enc', body.content_enc)
  await requireSignature(userId, Buffer.from(contentEnc), body.signature, 'du contenu')
  await validateQuestion(body.question_id)
  const row = await prisma().journal_entries.update({
    where: { id },
    data: {
      content_enc: contentEnc,
      updated_at: new Date(),
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.question_id !== undefined ? { question_id: body.question_id } : {}),
      ...(body.word_count_approx !== undefined ? { word_count_approx: body.word_count_approx } : {}),
    },
    select: entrySelect,
  })
  return toView(row)
}

export async function deleteEntry(userId: string, id: string, signatureB64: string): Promise<{ deleted: true }> {
  await ownEntry(userId, id)
  await requireSignature(userId, Buffer.from(id, 'utf8'), signatureB64, 'de suppression')
  await prisma().$transaction([
    prisma().checkin_log.updateMany({ where: { journal_entry_id: id }, data: { journal_entry_id: null } }),
    prisma().journal_entries.delete({ where: { id } }),
  ])
  return { deleted: true }
}

// --- Wrapped annuel (Techniques §10.3, DEC-32) ---------------------------------------

const WRAPPED_MIN_ENTRIES = 6
const WATERMARK = 'relais.app'

export interface WrappedView {
  year: number
  entry_count: number
  stats_enc: string
  exported: boolean
  exported_at: string | null
  generated_at: string
}

export interface WrappedExportView {
  year: number
  entry_count: number
  generated_at: string
  exported: boolean
  watermark: string
}

type WrappedRow = {
  year: number
  entry_count: number
  stats_enc: Uint8Array
  exported: boolean
  exported_at: Date | null
  generated_at: Date
}

function toWrappedView(r: WrappedRow): WrappedView {
  return {
    year: r.year,
    entry_count: r.entry_count,
    stats_enc: Buffer.from(r.stats_enc).toString('base64'),
    exported: r.exported,
    exported_at: r.exported_at?.toISOString() ?? null,
    generated_at: r.generated_at.toISOString(),
  }
}

const FIRST_YEAR = 2026 // chk annual_wrappeds.year >= 2026

/** Année valide : entre 2026 et l'année courante. */
export function parseYear(raw: string, now = new Date()): number {
  const year = Number.parseInt(raw, 10)
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > now.getUTCFullYear()) {
    throw new AppError('VALIDATION_ERROR', { details: { year: `entre ${FIRST_YEAR} et ${now.getUTCFullYear()}` } })
  }
  return year
}

/** DEC-32 : le nombre d'entrées vient de la base, jamais de l'app. */
async function entryCountForYear(userId: string, year: number): Promise<number> {
  return prisma().journal_entries.count({
    where: { user_id: userId, entry_month: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
  })
}

export async function saveWrapped(userId: string, year: number, body: WrappedBody, now = new Date()): Promise<{ view: WrappedView; created: boolean }> {
  const statsEnc = decodeOrThrow('stats_enc', body.stats_enc)
  await requireSignature(userId, Buffer.from(statsEnc), body.signature, 'des statistiques')
  const count = await entryCountForYear(userId, year)
  if (count < WRAPPED_MIN_ENTRIES) {
    throw new AppError('WRAPPED_INSUFFICIENT_ENTRIES', { details: { current: count, required: WRAPPED_MIN_ENTRIES } })
  }
  const existing = await prisma().annual_wrappeds.findUnique({ where: { user_id_year: { user_id: userId, year } }, select: { id: true } })
  const row = await prisma().annual_wrappeds.upsert({
    where: { user_id_year: { user_id: userId, year } },
    create: { user_id: userId, year, stats_enc: statsEnc, entry_count: count, generated_at: now },
    update: { stats_enc: statsEnc, entry_count: count, generated_at: now },
  })
  return { view: toWrappedView(row), created: existing === null }
}

async function ownWrapped(userId: string, year: number) {
  const row = await prisma().annual_wrappeds.findUnique({ where: { user_id_year: { user_id: userId, year } } })
  if (!row) throw new AppError('NOT_FOUND', { message: 'Pas de Wrapped pour cette année.' })
  return row
}

export async function getWrapped(userId: string, year: number): Promise<WrappedView> {
  return toWrappedView(await ownWrapped(userId, year))
}

/** Ce qu'il faut pour composer l'image localement — jamais de contenu, jamais de stats en clair. */
export async function wrappedExportMeta(userId: string, year: number): Promise<WrappedExportView> {
  const r = await ownWrapped(userId, year)
  return { year: r.year, entry_count: r.entry_count, generated_at: r.generated_at.toISOString(), exported: r.exported, watermark: WATERMARK }
}

export async function markWrappedExported(userId: string, year: number, now = new Date()): Promise<WrappedView> {
  const r = await ownWrapped(userId, year)
  const row = await prisma().annual_wrappeds.update({ where: { id: r.id }, data: { exported: true, exported_at: now } })
  return toWrappedView(row)
}
