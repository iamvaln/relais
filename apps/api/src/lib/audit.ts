// Journal d'audit des actions admin (Schéma table 19, BO-06 §6.3) — append-only
// par trigger. Jamais de donnée personnelle : des identifiants, des valeurs
// avant/après de configuration, un hash d'IP.

import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { sha256Hex } from './crypto.js'

export const AUDIT_ACTIONS = [
  'ACCOUNT_UNBLOCK',
  'ACCOUNT_SUSPEND',
  'ACCOUNT_DELETE',
  'OTP_REGEN',
  'EMAIL_CHANGE',
  'PHONE_CHANGE',
  'CONTACT_UNBLOCK',
  'ESCROW_EXTEND',
  'TRANSMISSION_CANCEL',
  'TRANSMISSION_NOTIFY',
  'CONFIG_UPDATE',
  'QUESTION_ADD',
  'QUESTION_ARCHIVE',
  'QUESTION_UPDATE',
  'SUBSCRIPTION_EXTEND',
  'PLAN_CHANGE',
  'ADMIN_LOGIN',
  'ADMIN_CREATED',
  'TICKET_UPDATE',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]
export type AuditTarget = 'user' | 'transmission' | 'config' | 'question' | 'subscription' | 'admin' | 'ticket'

export interface AuditEntry {
  /** NULL pour une action système ou le script de bootstrap. */
  adminId: string | null
  action: AuditAction
  targetType?: AuditTarget
  targetId?: string
  userId?: string
  before?: unknown
  after?: unknown
  reason?: string
  /** IP brute — seul son hash est conservé. */
  ip: string
  userAgent?: string
}

export async function audit(e: AuditEntry): Promise<void> {
  await prisma().audit_logs.create({
    data: {
      admin_id: e.adminId,
      user_id: e.userId ?? null,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      ...(e.before !== undefined ? { value_before: e.before as Prisma.InputJsonValue } : {}),
      ...(e.after !== undefined ? { value_after: e.after as Prisma.InputJsonValue } : {}),
      reason: e.reason ?? null,
      ip_hash: sha256Hex(e.ip),
      user_agent_hash: e.userAgent ? sha256Hex(e.userAgent) : null,
    },
  })
}
