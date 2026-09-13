// BO-06 — journal d'audit et santé.

import { healthReport, type HealthReport } from '../health/routes.js'
import { chainStatus, type ChainStatus } from '../../services/chain/reconcile.js'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import type { AuditListQuery } from './schemas.js'
import type { Page } from './users.js'

const DAY_MS = 24 * 3600 * 1000

export interface AuditView {
  id: string
  admin_id: string | null
  user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  value_before: unknown
  value_after: unknown
  reason: string | null
  ip_hash: string
  created_at: string
}

export async function listAudit(q: AuditListQuery): Promise<Page<AuditView>> {
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10))
  const limit = Math.min(100, Math.max(1, Number.parseInt(q.limit ?? '50', 10)))
  const where = {
    ...(q.action ? { action: q.action } : {}),
    ...(q.admin_id ? { admin_id: q.admin_id } : {}),
    ...(q.target_id ? { target_id: q.target_id } : {}),
    ...(q.from || q.to
      ? {
          created_at: {
            ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
            ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + DAY_MS) } : {}),
          },
        }
      : {}),
  }
  const [total, rows] = await Promise.all([
    prisma().audit_logs.count({ where }),
    prisma().audit_logs.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ])
  return {
    items: rows.map((r) => ({
      id: r.id,
      admin_id: r.admin_id,
      user_id: r.user_id,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      value_before: r.value_before,
      value_after: r.value_after,
      reason: r.reason,
      ip_hash: r.ip_hash,
      created_at: r.created_at.toISOString(),
    })),
    total,
    page,
    limit,
  }
}

export interface AdminHealthView extends HealthReport {
  jobs: { enabled: boolean }
  counts: { users: number; transmissions_open: number; escrows_active: number }
  /** Lot 2a : la chaîne Arbitrum — identifiant, bloc, opérateur et son solde, file, dernière réconciliation. */
  chain: ChainStatus
}

export async function adminHealth(now = new Date()): Promise<AdminHealthView> {
  const report = await healthReport()
  const [users, transmissionsOpen, escrowsActive] = await Promise.all([
    prisma().users.count({ where: { account_status: { not: 'deleted' } } }),
    prisma().transmissions.count({ where: { status: { in: ['triggered', 'in_progress'] } } }),
    prisma().transmissions.count({ where: { status: { in: ['triggered', 'in_progress'] }, escrow_expires_at: { gt: now } } }),
  ])
  return { ...report, jobs: { enabled: env().JOBS_ENABLED === 'true' }, counts: { users, transmissions_open: transmissionsOpen, escrows_active: escrowsActive }, chain: await chainStatus() }
}
