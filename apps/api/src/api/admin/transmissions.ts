// BO-03 — Transmissions : suivi des dead man's switch déclenchés et gestion
// des escrows. Statuts, compteurs et horodatages seulement — jamais
// l'identité d'un contact, jamais un contenu.

import { env } from '../../config/env.js'
import { configInt } from '../../lib/app-config.js'
import { audit } from '../../lib/audit.js'
import { hmacToken, randomToken } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import { emailService } from '../../services/email/index.js'
import { closeTransmission, escrowKeyId, notifyContactsCancelled, notifyOwner } from '../relay/service.js'
import { openNotification } from '../transmission/service.js'
import type { Page } from './users.js'
import type { RequestContext } from './service.js'
import type { ExtendEscrowBody, TransmissionListQuery } from './schemas.js'

const HOUR_MS = 3600 * 1000
const OPEN = ['triggered', 'in_progress']

// --- Vues ------------------------------------------------------------------------

export interface TransmissionRowView {
  id: string
  status: string
  triggered_at: string
  schema: { n: number; m: number }
  contacts_notified: number
  contacts_confirmed: number
  unlocked: { k1: boolean; k2: boolean; k3: boolean }
  escrow_active: boolean
  escrow_expires_at: string
  escrow_ttl_seconds: number
  escrow_extended_count: number
  completed_at: string | null
  cancelled_at: string | null
}

export interface TransmissionContactView {
  id: string
  status: string
  fail_count: number
  blocked: boolean
  roles: { k1: boolean; k2: boolean; k3: boolean }
  notified_at: string
  answered_at: string | null
  confirmed_at: string | null
}

export interface AuditRowView {
  id: string
  action: string
  admin_id: string | null
  reason: string | null
  created_at: string
}

export interface TransmissionDetailView extends TransmissionRowView {
  user_id: string
  cancellation_reason: string | null
  contacts: TransmissionContactView[]
  audit: AuditRowView[]
}

const rowInclude = {
  transmission_contacts: {
    select: {
      id: true,
      status: true,
      fail_count: true,
      blocked: true,
      notified_at: true,
      answered_at: true,
      confirmed_at: true,
      trusted_contacts: { select: { has_k1_role: true, has_k2_role: true, has_k3_role: true } },
    },
  },
} as const

type Row = NonNullable<Awaited<ReturnType<typeof findRow>>>

async function findRow(id: string) {
  return prisma().transmissions.findUnique({ where: { id }, include: rowInclude })
}

function toRow(t: Row, now: Date): TransmissionRowView {
  const ttl = Math.max(0, Math.floor((t.escrow_expires_at.getTime() - now.getTime()) / 1000))
  return {
    id: t.id,
    status: t.status,
    triggered_at: t.triggered_at.toISOString(),
    schema: { n: t.schema_n_snapshot, m: t.schema_m_snapshot },
    contacts_notified: t.transmission_contacts.length,
    contacts_confirmed: t.transmission_contacts.filter((c) => c.status === 'answered' || c.status === 'confirmed').length,
    unlocked: { k1: t.k1_completed, k2: t.k2_completed, k3: t.k3_completed },
    escrow_active: OPEN.includes(t.status) && ttl > 0,
    escrow_expires_at: t.escrow_expires_at.toISOString(),
    escrow_ttl_seconds: ttl,
    escrow_extended_count: t.escrow_extended_count,
    completed_at: t.completed_at?.toISOString() ?? null,
    cancelled_at: t.cancelled_at?.toISOString() ?? null,
  }
}

function toContact(c: Row['transmission_contacts'][number]): TransmissionContactView {
  return {
    id: c.id,
    status: c.status,
    fail_count: c.fail_count,
    blocked: c.blocked,
    roles: { k1: c.trusted_contacts.has_k1_role, k2: c.trusted_contacts.has_k2_role, k3: c.trusted_contacts.has_k3_role },
    notified_at: c.notified_at.toISOString(),
    answered_at: c.answered_at?.toISOString() ?? null,
    confirmed_at: c.confirmed_at?.toISOString() ?? null,
  }
}

// --- Liste et détail --------------------------------------------------------------

export async function listTransmissions(q: TransmissionListQuery, now = new Date()): Promise<Page<TransmissionRowView>> {
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10))
  const limit = Math.min(100, Math.max(1, Number.parseInt(q.limit ?? '20', 10)))
  const where = q.status ? { status: q.status } : {}
  const [total, rows] = await Promise.all([
    prisma().transmissions.count({ where }),
    prisma().transmissions.findMany({ where, orderBy: { triggered_at: 'desc' }, skip: (page - 1) * limit, take: limit, include: rowInclude }),
  ])
  return { items: rows.map((r) => toRow(r, now)), total, page, limit }
}

async function rowOrThrow(id: string): Promise<Row> {
  const t = await findRow(id)
  if (!t) throw new AppError('NOT_FOUND', { message: 'Transmission introuvable.' })
  return t
}

export async function getTransmission(id: string, now = new Date()): Promise<TransmissionDetailView> {
  const t = await rowOrThrow(id)
  const logs = await prisma().audit_logs.findMany({
    where: { target_type: 'transmission', target_id: id },
    orderBy: { created_at: 'desc' },
    select: { id: true, action: true, admin_id: true, reason: true, created_at: true },
  })
  return {
    ...toRow(t, now),
    user_id: t.user_id,
    cancellation_reason: t.cancellation_reason,
    contacts: t.transmission_contacts.map(toContact),
    audit: logs.map((l) => ({ ...l, created_at: l.created_at.toISOString() })),
  }
}

// --- Actions ----------------------------------------------------------------------

function assertOpen(t: Row): void {
  if (!OPEN.includes(t.status)) throw new AppError('TRANSMISSION_ALREADY_ACTIVE', { message: `Transmission ${t.status} : plus d'action possible.` })
}

/** BO-02 « Étendre l'escrow » : +24 h ou +48 h, dms.escrow_max_extensions fois au plus. */
export async function extendEscrow(adminId: string, id: string, body: ExtendEscrowBody, ctx: RequestContext, now = new Date()): Promise<TransmissionDetailView> {
  const t = await rowOrThrow(id)
  assertOpen(t)
  const max = await configInt('dms.escrow_max_extensions', 2)
  if (t.escrow_extended_count >= max) {
    throw new AppError('ESCROW_MAX_EXTENSIONS', { details: { max_extensions: max } })
  }
  const expiresAt = new Date(t.escrow_expires_at.getTime() + body.hours * HOUR_MS)
  await prisma().$transaction([
    prisma().transmissions.update({ where: { id }, data: { escrow_expires_at: expiresAt, escrow_extended_count: t.escrow_extended_count + 1 } }),
    prisma().escrow_shares.updateMany({ where: { transmission_id: id }, data: { expires_at: expiresAt } }),
    prisma().transmission_contacts.updateMany({ where: { transmission_id: id, relay_token_expires_at: { lt: expiresAt } }, data: { relay_token_expires_at: expiresAt } }),
  ])
  // La clé éphémère suit l'escrow (au moins) ; si l'accès est déjà déverrouillé elle vit plus longtemps, on ne la raccourcit pas.
  const key = escrowKeyId(id)
  const current = await redis().ttl(key)
  const wanted = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)
  if (current >= 0 && current < wanted) await redis().expire(key, wanted)
  await audit({
    adminId,
    action: 'ESCROW_EXTEND',
    targetType: 'transmission',
    targetId: id,
    userId: t.user_id,
    before: { escrow_expires_at: t.escrow_expires_at.toISOString(), escrow_extended_count: t.escrow_extended_count },
    after: { escrow_expires_at: expiresAt.toISOString(), escrow_extended_count: t.escrow_extended_count + 1 },
    reason: body.reason,
    ip: ctx.ip,
  })
  return getTransmission(id, now)
}

/** Relance : nouveau lien pour chaque contact qui n'a pas répondu ; l'ancien lien meurt. */
export async function notifyContacts(adminId: string, id: string, reason: string, ctx: RequestContext, now = new Date()): Promise<{ notified: number }> {
  const t = await rowOrThrow(id)
  assertOpen(t)
  const pending = await prisma().transmission_contacts.findMany({
    where: { transmission_id: id, status: 'notified' },
    include: { trusted_contacts: { select: { notification_enc: true } } },
  })
  const owner = await prisma().users.findUniqueOrThrow({ where: { id: t.user_id }, select: { full_name: true, language: true } })
  let notified = 0
  for (const c of pending) {
    const token = randomToken(32)
    await prisma().transmission_contacts.update({
      where: { id: c.id },
      data: { relay_token_hash: hmacToken(token), relay_token_expires_at: t.escrow_expires_at, relay_token_used: false, notified_at: now },
    })
    // Audit MEDIUM-10 : une sealed box illisible n'arrête pas la relance des autres.
    let email: string
    try {
      email = (await openNotification(c.trusted_contacts.notification_enc)).email
    } catch {
      continue
    }
    const { sent } = await emailService().send({
      userId: t.user_id,
      to: email,
      type: 'transmission_contact',
      locale: owner.language === 'en' ? 'en' : 'fr',
      params: { owner: owner.full_name, link: `${env().FRONTEND_URL}/relay/${token}` },
    })
    if (sent) notified++
  }
  await audit({ adminId, action: 'TRANSMISSION_NOTIFY', targetType: 'transmission', targetId: id, userId: t.user_id, after: { notified }, reason, ip: ctx.ip })
  return { notified }
}

/**
 * Annulation (super_admin, BO-03) : l'owner est vivant. Escrow purgé, liens
 * morts, sa configuration reprend vie (logique partagée avec l'annulation par
 * l'owner, `closeTransmission`) ; les contacts sont prévenus.
 */
export async function cancelTransmission(adminId: string, id: string, reason: string, ctx: RequestContext, now = new Date()): Promise<TransmissionDetailView> {
  const t = await rowOrThrow(id)
  assertOpen(t)
  await closeTransmission(t, { adminId, reason }, now)
  const owner = await prisma().users.findUniqueOrThrow({ where: { id: t.user_id }, select: { language: true } })
  await notifyContactsCancelled(id, t.user_id, owner.language === 'en' ? 'en' : 'fr')
  await audit({ adminId, action: 'TRANSMISSION_CANCEL', targetType: 'transmission', targetId: id, userId: t.user_id, before: { status: t.status }, after: { status: 'cancelled' }, reason, ip: ctx.ip })
  return getTransmission(id, now)
}

/** BO-02 cas 3 : réinitialise les 5 tentatives d'un contact bloqué — sans rien voir de lui. */
export async function unblockContact(adminId: string, id: string, contactId: string, reason: string, ctx: RequestContext): Promise<TransmissionContactView> {
  const t = await rowOrThrow(id)
  const c = t.transmission_contacts.find((x) => x.id === contactId)
  if (!c) throw new AppError('NOT_FOUND', { message: 'Contact introuvable sur cette transmission.' })
  const tcId = (await prisma().transmission_contacts.findUniqueOrThrow({ where: { id: contactId }, select: { trusted_contact_id: true } })).trusted_contact_id
  const [updated] = await prisma().$transaction([
    prisma().transmission_contacts.update({
      where: { id: contactId },
      data: { blocked: false, fail_count: 0, status: c.status === 'failed' ? 'notified' : c.status },
      select: rowInclude.transmission_contacts.select,
    }),
    prisma().trusted_contacts.update({ where: { id: tcId }, data: { blocked_until: null, fail_count: 0 } }),
  ])
  await audit({ adminId, action: 'CONTACT_UNBLOCK', targetType: 'transmission', targetId: id, userId: t.user_id, before: { fail_count: c.fail_count, blocked: c.blocked }, after: { fail_count: 0, blocked: false }, reason, ip: ctx.ip })
  // L'owner est prévenu (12/09/2026) — un déblocage sur son coffre n'est pas anodin.
  const owner = await prisma().users.findUniqueOrThrow({ where: { id: t.user_id }, select: { id: true, email: true, full_name: true, language: true } })
  await notifyOwner(owner, 'contact_unblocked')
  return toContact(updated)
}
