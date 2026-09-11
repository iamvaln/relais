// BO-04 — bibliothèque de questions, BO-05 — configuration système.

import { Prisma } from '@prisma/client'
import { audit } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import type { RequestContext } from './service.js'
import type { ConfigUpdateBody, QuestionCreateBody, QuestionListQuery, QuestionUpdateBody } from './schemas.js'

// --- Questions -----------------------------------------------------------------

export interface QuestionView {
  id: string
  text_fr: string
  text_en: string
  category: string
  usage_type: string
  reliability_score: number
  status: string
  risk_notes: string | null
  cycle_month: number | null
  mode_target: string | null
  usage_count: number
  failure_rate: number
  block_rate: number
  created_at: string
  updated_at: string
}

const questionSelect = {
  id: true,
  text_fr: true,
  text_en: true,
  category: true,
  usage_type: true,
  reliability_score: true,
  status: true,
  risk_notes: true,
  cycle_month: true,
  mode_target: true,
  usage_count: true,
  failure_rate: true,
  block_rate: true,
  created_at: true,
  updated_at: true,
} as const

type QuestionRow = Prisma.checkin_questionsGetPayload<{ select: typeof questionSelect }>

function toQuestion(q: QuestionRow): QuestionView {
  return {
    ...q,
    failure_rate: Number(q.failure_rate),
    block_rate: Number(q.block_rate),
    created_at: q.created_at.toISOString(),
    updated_at: q.updated_at.toISOString(),
  }
}

export async function listQuestions(q: QuestionListQuery): Promise<QuestionView[]> {
  const rows = await prisma().checkin_questions.findMany({
    where: {
      ...(q.usage_type ? { usage_type: q.usage_type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.category ? { category: q.category } : {}),
    },
    orderBy: [{ usage_type: 'asc' }, { category: 'asc' }, { text_fr: 'asc' }],
    select: questionSelect,
  })
  return rows.map(toQuestion)
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function createQuestion(adminId: string, body: QuestionCreateBody, ctx: RequestContext): Promise<QuestionView> {
  let row: QuestionRow
  try {
    row = await prisma().checkin_questions.create({
      data: {
        text_fr: body.text_fr,
        text_en: body.text_en,
        category: body.category,
        usage_type: body.usage_type,
        reliability_score: body.reliability_score,
        risk_notes: body.risk_notes ?? null,
        cycle_month: body.cycle_month ?? null,
        mode_target: body.mode_target ?? 'all',
      },
      select: questionSelect,
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('QUESTION_DUPLICATE')
    throw err
  }
  await audit({ adminId, action: 'QUESTION_ADD', targetType: 'question', targetId: row.id, after: { category: row.category, usage_type: row.usage_type, reliability_score: row.reliability_score }, ip: ctx.ip })
  return toQuestion(row)
}

async function questionOrThrow(id: string): Promise<QuestionRow> {
  const q = await prisma().checkin_questions.findUnique({ where: { id }, select: questionSelect })
  if (!q) throw new AppError('NOT_FOUND', { message: 'Question introuvable.' })
  return q
}

const AUDITED_FIELDS = ['text_fr', 'text_en', 'category', 'usage_type', 'reliability_score', 'risk_notes', 'cycle_month', 'mode_target', 'status'] as const

function snapshot(q: QuestionRow, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f, (q as Record<string, unknown>)[f]]))
}

export async function updateQuestion(adminId: string, id: string, body: QuestionUpdateBody, ctx: RequestContext): Promise<QuestionView> {
  const before = await questionOrThrow(id)
  const changed = AUDITED_FIELDS.filter((f) => body[f as keyof QuestionUpdateBody] !== undefined)
  let row: QuestionRow
  try {
    row = await prisma().checkin_questions.update({ where: { id }, data: { ...body, updated_at: new Date() }, select: questionSelect })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('QUESTION_DUPLICATE')
    throw err
  }
  await audit({ adminId, action: 'QUESTION_UPDATE', targetType: 'question', targetId: id, before: snapshot(before, changed), after: snapshot(row, changed), ip: ctx.ip })
  return toQuestion(row)
}

/** Archiver : retirée des propositions, les usages existants (FK) restent. */
export async function archiveQuestion(adminId: string, id: string, reason: string, ctx: RequestContext): Promise<QuestionView> {
  const before = await questionOrThrow(id)
  const row = await prisma().checkin_questions.update({ where: { id }, data: { status: 'archived', updated_at: new Date() }, select: questionSelect })
  await audit({ adminId, action: 'QUESTION_ARCHIVE', targetType: 'question', targetId: id, before: { status: before.status }, after: { status: 'archived' }, reason, ip: ctx.ip })
  return toQuestion(row)
}

// --- Configuration (BO-05) --------------------------------------------------------

export interface ConfigView {
  key: string
  value: unknown
  config_type: string
  category: string
  description: string
  updated_by: string | null
  updated_at: string
}

type ConfigRow = { key: string; value: string; config_type: string; category: string; description: string; updated_by: string | null; updated_at: Date }

function parseStored(type: string, raw: string): unknown {
  switch (type) {
    case 'int':
      return Number.parseInt(raw, 10)
    case 'bool':
      return raw === 'true'
    case 'json':
    case 'array_int':
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    default:
      return raw
  }
}

/** Valide la valeur reçue selon config_type et rend sa forme stockée (texte). */
function serialize(type: string, value: unknown): string {
  const bad = (why: string): never => {
    throw new AppError('VALIDATION_ERROR', { details: { value: why } })
  }
  switch (type) {
    case 'int':
      return Number.isInteger(value) ? String(value) : bad('entier attendu')
    case 'bool':
      return typeof value === 'boolean' ? String(value) : bad('booléen attendu')
    case 'array_int':
      return Array.isArray(value) && value.every((n) => Number.isInteger(n)) ? JSON.stringify(value) : bad("tableau d'entiers attendu")
    case 'json':
      return value !== undefined ? JSON.stringify(value) : bad('valeur JSON attendue')
    default:
      return typeof value === 'string' ? value : bad('chaîne attendue')
  }
}

function toConfig(r: ConfigRow): ConfigView {
  return { key: r.key, value: parseStored(r.config_type, r.value), config_type: r.config_type, category: r.category, description: r.description, updated_by: r.updated_by, updated_at: r.updated_at.toISOString() }
}

export async function listConfig(): Promise<ConfigView[]> {
  const rows = await prisma().app_config.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] })
  return rows.map(toConfig)
}

export async function updateConfig(adminId: string, key: string, body: ConfigUpdateBody, ctx: RequestContext): Promise<ConfigView> {
  const row = await prisma().app_config.findUnique({ where: { key } })
  if (!row) throw new AppError('NOT_FOUND', { message: 'Paramètre inconnu.' })
  const stored = serialize(row.config_type, body.value)
  const updated = await prisma().app_config.update({ where: { key }, data: { value: stored, updated_by: adminId, updated_at: new Date() } })
  await audit({
    adminId,
    action: 'CONFIG_UPDATE',
    targetType: 'config',
    targetId: key,
    before: { value: row.value },
    after: { value: stored },
    ...(body.reason ? { reason: body.reason } : {}),
    ip: ctx.ip,
  })
  return toConfig(updated)
}
