// Réconciliation quotidienne (docs/smart-contract-v2.md §3) : la base reste
// maître ; la chaîne est lue et comparée, jamais corrigée d'autorité. Les
// écarts remontent au tableau de bord (chain_divergence) avec le solde de
// l'opérateur (chain_gas_low). Un seul cas où la chaîne commande : un
// `Triggered` posé par un tiers alors que la base dit vivant — le contrat a
// vérifié que le silence avait couru ; si CHAIN_TRUST_TRIGGERS le permet,
// l'API ouvre la transmission (fin du mode miroir). Sinon l'écart est signalé.

import { formatEther, type Hex } from 'viem'
import { env } from '../../config/env.js'
import { keys, redis } from '../../lib/redis.js'
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'
import type { DashboardAlert } from '../../api/admin/dashboard.js'
import { startTransmission } from '../../api/relay/service.js'
import { chainService } from './index.js'
import { DATE_TOLERANCE_S, DAY_S, ceilDaySeconds } from './message.js'
import { recordBalance } from './balance.js'

/** 0,01 ETH : en dessous, l'opérateur ne paiera bientôt plus le gaz. */
export const GAS_LOW_WEI = 10n ** 16n
const STALE_QUEUE_HOURS = 24
const FAILED_WINDOW_DAYS = 7
/** Échéance en base non arrondie, signée à ± 2 jours, arrondie au jour : trois jours d'écart sont normaux. */
const DUE_TOLERANCE_S = DATE_TOLERANCE_S + DAY_S

export type DivergenceType = 'unregistered' | 'status' | 'next_due' | 'chain_triggered' | 'stale_queue' | 'failed_write'

export interface Divergence {
  subject: string | null
  user_id: string | null
  type: DivergenceType
  db?: string | undefined
  chain?: string | undefined
}

export interface ReconcileResult {
  checked: number
  opened: number
  divergences: Divergence[]
}

export interface ReconcileSummary {
  at: string
  checked: number
  opened: number
  divergences: number
  types: Record<string, number>
}

export async function reconcile(now = new Date(), opts: { trustTriggers?: boolean } = {}): Promise<ReconcileResult> {
  const svc = chainService()
  const result: ReconcileResult = { checked: 0, opened: 0, divergences: [] }
  if (!svc.enabled) return result
  const trust = opts.trustTriggers ?? env().CHAIN_TRUST_TRIGGERS === 'true'

  const configs = await prisma().transmission_configs.findMany({
    where: { OR: [{ status: { in: ['active', 'paused', 'triggered'] } }, { chain_subject: { not: null } }] },
    select: { id: true, user_id: true, status: true, chain_subject: true, contract_registered: true, next_checkin_due: true, pause_until: true },
  })
  const nowS = Math.floor(now.getTime() / 1000)

  for (const cfg of configs) {
    result.checked++
    const live = cfg.status === 'active' || cfg.status === 'paused' || cfg.status === 'triggered'
    if (!cfg.chain_subject || !cfg.contract_registered) {
      if (live) result.divergences.push({ subject: cfg.chain_subject, user_id: cfg.user_id, type: 'unregistered' })
      continue
    }
    const subject = cfg.chain_subject as Hex
    const d = await svc.readDms(subject)
    const pending = await prisma().chain_sync.findMany({ where: { subject, status: 'queued' }, select: { action: true } })
    const queued = new Set(pending.map((p) => p.action))
    const push = (type: DivergenceType) => result.divergences.push({ subject, user_id: cfg.user_id, type, db: cfg.status, chain: d.status })

    if (d.status === 'triggered' && (cfg.status === 'active' || cfg.status === 'paused')) {
      if (!trust) {
        push('chain_triggered')
        continue
      }
      const event = await svc.lastTriggered(subject)
      await prisma().transmission_configs.update({ where: { id: cfg.id }, data: { status: 'triggered' } })
      await startTransmission(cfg.id, now)
      if (event) {
        const tr = await prisma().transmissions.findFirst({ where: { transmission_config_id: cfg.id, status: 'triggered' }, orderBy: { triggered_at: 'desc' }, select: { id: true } })
        if (tr) await prisma().transmissions.update({ where: { id: tr.id }, data: { arbitrum_trigger_block: event.blockNumber.toString() } })
      }
      logger().info({ block: event?.blockNumber.toString() }, 'chaîne : déclenchement tiers, transmission ouverte')
      result.opened++
      continue
    }

    const chainPauseExpired = d.status === 'paused' && d.pausedUntil <= nowS
    let statusOk: boolean
    switch (cfg.status) {
      case 'active':
        statusOk = d.status === 'active' || chainPauseExpired
        break
      case 'paused':
        statusOk = d.status === 'paused' || queued.has('pause')
        break
      case 'triggered':
        statusOk = d.status === 'triggered' || queued.has('trigger')
        break
      case 'completed':
        statusOk = d.status === 'completed' || queued.has('complete')
        break
      default:
        statusOk = d.status === 'inactive' || queued.has('deactivate')
    }
    if (!statusOk) {
      push('status')
      continue
    }
    if (cfg.status === 'active' && d.status === 'active' && cfg.next_checkin_due && !queued.has('checkin') && !queued.has('resume') && !queued.has('cancelTrigger')) {
      const expected = ceilDaySeconds(cfg.next_checkin_due)
      if (Math.abs(d.nextCheckinDue - expected) > DUE_TOLERANCE_S) {
        result.divergences.push({ subject, user_id: cfg.user_id, type: 'next_due', db: String(expected), chain: String(d.nextCheckinDue) })
      }
    }
  }

  // La file elle-même : ce qui n'avance plus, ce que le contrat a refusé. Les
  // dates des lignes viennent de l'horloge de la base : c'est elle qui juge.
  type QueueRow = { subject: string; user_id: string | null; error: string | null }
  const [stale, failed] = await Promise.all([
    prisma().$queryRaw<QueueRow[]>`SELECT subject, user_id, error FROM chain_sync WHERE status = 'queued' AND created_at < now() - ${STALE_QUEUE_HOURS}::int * interval '1 hour'`,
    prisma().$queryRaw<QueueRow[]>`SELECT subject, user_id, error FROM chain_sync WHERE status = 'failed' AND updated_at > now() - ${FAILED_WINDOW_DAYS}::int * interval '1 day'`,
  ])
  for (const r of stale) result.divergences.push({ subject: r.subject, user_id: r.user_id, type: 'stale_queue' })
  for (const r of failed) result.divergences.push({ subject: r.subject, user_id: r.user_id, type: 'failed_write', chain: r.error ?? undefined })

  await recordBalance(svc)
  const types: Record<string, number> = {}
  for (const dv of result.divergences) types[dv.type] = (types[dv.type] ?? 0) + 1
  const summary: ReconcileSummary = { at: now.toISOString(), checked: result.checked, opened: result.opened, divergences: result.divergences.length, types }
  await redis().set(keys.chainReconcile(), JSON.stringify(summary))
  if (result.divergences.length > 0) logger().warn({ ...summary }, 'chaîne : écarts de réconciliation')
  return result
}

async function lastSummary(): Promise<ReconcileSummary | null> {
  const raw = await redis().get(keys.chainReconcile())
  return raw ? (JSON.parse(raw) as ReconcileSummary) : null
}

/** Alertes BO-01 : gaz bas (haute), écarts de la dernière réconciliation (moyenne). */
export async function chainAlerts(): Promise<DashboardAlert[]> {
  if (!chainService().enabled) return []
  const out: DashboardAlert[] = []
  const balanceRaw = await redis().get(keys.chainBalance())
  if (balanceRaw !== null) {
    const balance = BigInt(balanceRaw)
    if (balance < GAS_LOW_WEI) out.push({ type: 'chain_gas_low', severity: 'high', count: 1, operator_balance_eth: formatEther(balance) })
  }
  const last = await lastSummary()
  if (last && last.divergences > 0) out.push({ type: 'chain_divergence', severity: 'medium', count: last.divergences, types: last.types })
  return out
}

export type ChainStatus =
  | { enabled: false }
  | {
      enabled: true
      chain_id: number | null
      block_number: string | null
      operator_address: string | null
      operator_balance_eth: string | null
      queued: number
      failed: number
      last_reconcile: ReconcileSummary | null
    }

/** La section `chain` de GET /admin/health. Une chaîne injoignable rend des null, pas une erreur. */
export async function chainStatus(): Promise<ChainStatus> {
  const svc = chainService()
  if (!svc.enabled) return { enabled: false }
  const [queued, failed, last] = await Promise.all([
    prisma().chain_sync.count({ where: { status: 'queued' } }),
    prisma().chain_sync.count({ where: { status: 'failed' } }),
    lastSummary(),
  ])
  let chainId: number | null = null
  let block: string | null = null
  let balance: string | null = null
  try {
    ;[chainId, block, balance] = await Promise.all([svc.chainId(), svc.blockNumber().then(String), svc.operatorBalanceWei().then(formatEther)])
  } catch {
    // RPC injoignable : la sonde `services.chain` le dit
  }
  return { enabled: true, chain_id: chainId, block_number: block, operator_address: svc.operatorAddress, operator_balance_eth: balance, queued, failed, last_reconcile: last }
}
