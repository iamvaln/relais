// BO-02 — tickets support côté back office : file, prise en charge, résolution.

import { audit } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { ticketSelect, toTicketView, type TicketView } from '../support/service.js'
import type { RequestContext } from './service.js'
import type { TicketListQuery, TicketUpdateBody } from './schemas.js'
import type { Page } from './users.js'

export interface AdminTicketView extends TicketView {
  user_id: string | null
  user_email: string
  assigned_to: string | null
}

const adminSelect = { ...ticketSelect, user_id: true, user_email: true, assigned_to: true } as const

type Row = NonNullable<Awaited<ReturnType<typeof find>>>

async function find(id: string) {
  return prisma().support_tickets.findUnique({ where: { id }, select: adminSelect })
}

function toAdminView(t: Row): AdminTicketView {
  return { ...toTicketView(t), user_id: t.user_id, user_email: t.user_email, assigned_to: t.assigned_to }
}

export async function listTickets(q: TicketListQuery): Promise<Page<AdminTicketView>> {
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10))
  const limit = Math.min(100, Math.max(1, Number.parseInt(q.limit ?? '20', 10)))
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.category ? { category: q.category } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma().support_tickets.count({ where }),
    prisma().support_tickets.findMany({ where, orderBy: [{ status: 'asc' }, { created_at: 'asc' }], skip: (page - 1) * limit, take: limit, select: adminSelect }),
  ])
  return { items: rows.map(toAdminView), total, page, limit }
}

async function rowOrThrow(id: string): Promise<Row> {
  const t = await find(id)
  if (!t) throw new AppError('NOT_FOUND', { message: 'Ticket introuvable.' })
  return t
}

export async function getTicket(id: string): Promise<AdminTicketView> {
  return toAdminView(await rowOrThrow(id))
}

const CLOSING = new Set(['resolved', 'closed'])

function snapshot(t: { status: string; priority: string; assigned_to: string | null; resolution_note: string | null }) {
  return { status: t.status, priority: t.priority, assigned_to: t.assigned_to, resolution_note: t.resolution_note }
}

export async function updateTicket(adminId: string, id: string, body: TicketUpdateBody, ctx: RequestContext, now = new Date()): Promise<AdminTicketView> {
  const before = await rowOrThrow(id)
  if (body.assigned_to) {
    const admin = await prisma().admin_users.findUnique({ where: { id: body.assigned_to }, select: { id: true } })
    if (!admin) throw new AppError('NOT_FOUND', { message: 'Admin assigné introuvable.' })
  }
  const closing = body.status !== undefined && CLOSING.has(body.status)
  const reopening = body.status !== undefined && !CLOSING.has(body.status)
  const row = await prisma().support_tickets.update({
    where: { id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.assigned_to !== undefined ? { assigned_to: body.assigned_to } : {}),
      ...(body.resolution_note !== undefined ? { resolution_note: body.resolution_note } : {}),
      ...(closing ? { resolved_at: before.resolved_at ?? now } : {}),
      ...(reopening ? { resolved_at: null } : {}),
      updated_at: now,
    },
    select: adminSelect,
  })
  await audit({ adminId, action: 'TICKET_UPDATE', targetType: 'ticket', targetId: id, ...(before.user_id ? { userId: before.user_id } : {}), before: snapshot(before), after: snapshot(row), ip: ctx.ip })
  return toAdminView(row)
}
