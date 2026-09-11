// Tickets support (BO-02). Ouverts sans compte : un utilisateur verrouillé ou
// sans OTP ne peut pas se connecter, et c'est précisément lui qui a besoin
// d'aide. La réponse ne dit jamais si l'email correspond à un compte.

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { normalizeEmail } from '../auth/service.js'
import type { TicketCreateBody } from './schemas.js'

export interface TicketView {
  id: string
  subject: string
  body: string
  category: string
  status: string
  priority: string
  resolution_note: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export const ticketSelect = {
  id: true,
  subject: true,
  body: true,
  category: true,
  status: true,
  priority: true,
  resolution_note: true,
  created_at: true,
  updated_at: true,
  resolved_at: true,
} as const

type TicketRow = {
  id: string
  subject: string
  body: string
  category: string
  status: string
  priority: string
  resolution_note: string | null
  created_at: Date
  updated_at: Date
  resolved_at: Date | null
}

export function toTicketView(t: TicketRow): TicketView {
  return {
    id: t.id,
    subject: t.subject,
    body: t.body,
    category: t.category,
    status: t.status,
    priority: t.priority,
    resolution_note: t.resolution_note,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
    resolved_at: t.resolved_at?.toISOString() ?? null,
  }
}

export async function createTicket(userId: string | null, body: TicketCreateBody): Promise<TicketView> {
  let email: string
  let ownerId: string | null = userId
  if (userId) {
    email = (await prisma().users.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email
  } else {
    if (!body.email) throw new AppError('VALIDATION_ERROR', { details: { email: 'requis sans compte connecté' } })
    email = normalizeEmail(body.email)
    ownerId = (await prisma().users.findUnique({ where: { email }, select: { id: true } }))?.id ?? null
  }
  const row = await prisma().support_tickets.create({
    data: { user_id: ownerId, user_email: email, subject: body.subject, body: body.body, category: body.category },
    select: ticketSelect,
  })
  return toTicketView(row)
}

export async function listMyTickets(userId: string): Promise<TicketView[]> {
  const rows = await prisma().support_tickets.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, select: ticketSelect })
  return rows.map(toTicketView)
}
