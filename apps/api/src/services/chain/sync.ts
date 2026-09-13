// Le miroir on-chain, côté API (docs/smart-contract-v2.md §3).
//
// 1. À l'action de l'owner, l'endpoint appelle `prepareChainAction` AVANT toute
//    écriture : la signature Ed25519 est vérifiée sur le message canonique, la
//    date signée doit être alignée au jour et à moins de deux jours de celle
//    que l'API calcule elle-même. Sans champ `chain`, ou chaîne désactivée,
//    rien ne se passe (mode miroir progressif : l'app envoie la signature
//    quand elle le peut ; la réconciliation dit qui manque).
// 2. Après l'écriture en base, `enqueue` insère une ligne chain_sync (statut
//    queued) : la table est la file. Les jobs opérateur seuls (trigger,
//    complete, setShareHashes) y entrent directement.
// 3. `drainChainQueue` (worker `chain:drain`, concurrence 1) traite les lignes
//    dans l'ordre, sujet par sujet : état on-chain lu d'abord — une écriture
//    déjà satisfaite est `skipped`, un revert déterministe est `failed`, une
//    panne réseau laisse la ligne `queued` (attempts++) ; un `trigger` pas
//    encore déclenchable attend, et les lignes suivantes du même sujet aussi.

import type { Prisma } from '@prisma/client'
import { keccak256, toHex, type Hex } from 'viem'
import { AppError } from '../../lib/errors.js'
import { decodeBase64 } from '../../lib/crypto.js'
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import { ChainRevertError, chainService, type ChainCall, type ChainService, type DmsView } from './index.js'
import { DATE_TOLERANCE_S, chainSubjectOf, isDayAligned, verifyOwnerChainSig, type ChainAction, type ChainFields } from './message.js'
import type { ChainField } from './schema.js'
import { recordBalance } from './balance.js'

export type SyncAction = ChainAction | 'setShareHashes' | 'trigger' | 'complete'

const DRAIN_LIMIT = 100

export interface EnqueueInput {
  subject: Hex
  action: SyncAction
  args: Record<string, unknown>
  userId?: string | undefined
  refId?: string | undefined
}

export async function enqueueChainWrite(input: EnqueueInput): Promise<string | null> {
  if (!chainService().enabled) return null
  const row = await prisma().chain_sync.create({
    data: { subject: input.subject, action: input.action, args: input.args as Prisma.InputJsonValue, user_id: input.userId ?? null, ref_id: input.refId ?? null },
    select: { id: true },
  })
  return row.id
}

// --- Préparation d'une action signée par l'owner ------------------------------------

export interface ChainContext {
  /** Le sujet déjà posé sur la config, ou null avant le premier enregistrement. */
  chainSubject: string | null
  chainRegisteredAt: Date | null
  ed25519Pk: Buffer | null
}

export interface ExpectedFields {
  /** Ce que l'API calcule elle-même ; la valeur signée doit s'en approcher. */
  nextDue?: Date
  pausedUntil?: Date
  n?: number
  m?: number
  silenceSecs?: number
  checkinFreqSecs?: number
}

export interface PreparedChain {
  subject: Hex
  action: ChainAction
  fields: ChainFields
  ownerSig: Hex
  ed25519Pk: Hex
  /** À appeler après l'écriture en base ; `register` enfile aussi setShareHashes depuis les contacts. */
  enqueue(ctx: { userId: string; configId: string; refId?: string | undefined }): Promise<void>
}

function mismatch(field: string, why: string): never {
  throw new AppError('CHAIN_FIELDS_MISMATCH', { details: { [field]: why } })
}

function signedDate(field: 'next_due' | 'paused_until', signed: number | undefined, expected: Date | undefined): number | undefined {
  if (expected === undefined) {
    if (signed !== undefined) mismatch(field, 'inattendu pour cette action')
    return undefined
  }
  if (signed === undefined) mismatch(field, 'requis pour cette action')
  if (!isDayAligned(signed)) mismatch(field, 'doit être aligné au jour (secondes Unix, multiple de 86 400)')
  if (Math.abs(signed - expected.getTime() / 1000) > DATE_TOLERANCE_S) mismatch(field, 'trop éloigné de la date calculée par le serveur (± 2 jours)')
  return signed
}

/**
 * Vérifie le champ `chain` d'une requête. Rend null quand il n'y a rien à faire
 * (chaîne désactivée ou champ absent). Lance CHAIN_FIELDS_MISMATCH,
 * CHAIN_SIG_INVALID ou CHAIN_NOT_REGISTERED.
 */
export async function prepareChainAction(
  chain: ChainField | undefined,
  defaultAction: ChainAction,
  allowed: readonly ChainAction[],
  ctx: ChainContext,
  expected: ExpectedFields,
): Promise<PreparedChain | null> {
  if (!chainService().enabled || !chain) return null
  const action = chain.action ?? defaultAction
  if (!allowed.includes(action)) throw new AppError('VALIDATION_ERROR', { details: { 'chain.action': `${action} n’est pas permis ici` } })
  if (!ctx.ed25519Pk) throw new AppError('AUTH_KEY_NOT_SET')
  const subject = chainSubjectOf(ctx.ed25519Pk)
  if (ctx.chainSubject && ctx.chainSubject !== subject) mismatch('subject', 'la clé du compte a changé depuis l’enregistrement')

  const fields: ChainFields = {}
  const nextDue = signedDate('next_due', chain.next_due, action === 'pause' || action === 'deactivate' ? undefined : expected.nextDue)
  if (nextDue !== undefined) fields.nextDue = nextDue
  const pausedUntil = signedDate('paused_until', chain.paused_until, action === 'pause' ? expected.pausedUntil : undefined)
  if (pausedUntil !== undefined) fields.pausedUntil = pausedUntil
  if (action === 'register') Object.assign(fields, { n: expected.n, m: expected.m, silenceSecs: expected.silenceSecs, checkinFreqSecs: expected.checkinFreqSecs })

  if (action !== 'register' && !ctx.chainRegisteredAt) {
    const pending = await prisma().chain_sync.count({ where: { subject, action: 'register', status: { in: ['queued', 'sent', 'confirmed'] } } })
    if (pending === 0) throw new AppError('CHAIN_NOT_REGISTERED')
  }

  const sig = decodeBase64(chain.sig)
  if (!sig || !verifyOwnerChainSig(ctx.ed25519Pk, sig, action, subject, fields)) throw new AppError('CHAIN_SIG_INVALID')

  const ownerSig = toHex(sig)
  const ed25519Pk = toHex(ctx.ed25519Pk)
  return {
    subject,
    action,
    fields,
    ownerSig,
    ed25519Pk,
    async enqueue({ userId, configId, refId }) {
      const args: Record<string, unknown> = { ownerSig }
      if (fields.nextDue !== undefined) args.nextDue = fields.nextDue
      if (fields.pausedUntil !== undefined) args.pausedUntil = fields.pausedUntil
      if (action === 'register') Object.assign(args, { ed25519Pk, n: fields.n, m: fields.m, silenceSecs: fields.silenceSecs, checkinFreqSecs: fields.checkinFreqSecs })
      await prisma().transmission_configs.update({ where: { id: configId }, data: { chain_subject: subject } })
      await enqueueChainWrite({ subject, action, args, userId, refId })
      if (action === 'register') {
        await enqueueChainWrite({ subject, action: 'setShareHashes', args: { hashes: await shareHashesFor(configId) }, userId })
      }
    },
  }
}

/**
 * Un haché par contact porteur, dans l'ordre des contacts (DEC-10) :
 * keccak256("sha256(Si_enc k1)|sha256(k2)|sha256(k3)"), un rôle absent → vide.
 */
export async function shareHashesFor(configId: string): Promise<Hex[]> {
  const rows = await prisma().trusted_contacts.findMany({
    where: { transmission_id: configId, contact_status: { not: 'removed' } },
    orderBy: { contact_order: 'asc' },
    select: { share_k1_hash: true, share_k2_hash: true, share_k3_hash: true },
  })
  return rows.map((c) => keccak256(Buffer.from(`${c.share_k1_hash ?? ''}|${c.share_k2_hash ?? ''}|${c.share_k3_hash ?? ''}`, 'utf8')))
}

// --- Le drain ---------------------------------------------------------------------------

export interface DrainResult {
  confirmed: number
  skipped: number
  failed: number
  /** Lignes laissées en file (pas encore déclenchable, ou panne passagère). */
  waiting: number
}

type Row = Prisma.chain_syncGetPayload<{ select: { id: true; subject: true; action: true; args: true; user_id: true; ref_id: true; attempts: true } }>
type Args = Record<string, unknown>

function num(a: Args, k: string): bigint {
  const v = a[k]
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`chain_sync.args.${k} manquant`)
  return BigInt(v)
}
function hex(a: Args, k: string): Hex {
  const v = a[k]
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]*$/.test(v)) throw new Error(`chain_sync.args.${k} manquant`)
  return v as Hex
}

function toCall(row: Row): ChainCall {
  const a = (row.args ?? {}) as Args
  const s = row.subject as Hex
  switch (row.action) {
    case 'register':
      return { fn: 'register', args: [s, hex(a, 'ed25519Pk'), Number(num(a, 'n')), Number(num(a, 'm')), Number(num(a, 'silenceSecs')), Number(num(a, 'checkinFreqSecs')), num(a, 'nextDue'), hex(a, 'ownerSig')] }
    case 'setShareHashes':
      return { fn: 'setShareHashes', args: [s, (a.hashes as Hex[]) ?? []] }
    case 'checkin':
      return { fn: 'checkin', args: [s, num(a, 'nextDue'), hex(a, 'ownerSig')] }
    case 'pause':
      return { fn: 'pause', args: [s, num(a, 'pausedUntil'), hex(a, 'ownerSig')] }
    case 'resume':
      return { fn: 'resume', args: [s, num(a, 'nextDue'), hex(a, 'ownerSig')] }
    case 'cancelTrigger':
      return { fn: 'cancelTrigger', args: [s, num(a, 'nextDue'), hex(a, 'ownerSig')] }
    case 'deactivate':
      return { fn: 'deactivate', args: [s, hex(a, 'ownerSig')] }
    case 'trigger':
      return { fn: 'trigger', args: [s] }
    case 'complete':
      return { fn: 'complete', args: [s] }
    default:
      throw new Error(`chain_sync.action inconnue : ${row.action}`)
  }
}

type Verdict = 'send' | 'skip' | 'wait'

/** L'état on-chain satisfait-il déjà l'écriture ? Sinon, peut-elle partir maintenant ? */
async function verdict(svc: ChainService, row: Row, d: DmsView): Promise<Verdict> {
  const a = (row.args ?? {}) as Args
  const live = d.status === 'active' || d.status === 'paused'
  switch (row.action) {
    case 'register':
      return live && d.nextCheckinDue >= Number(a.nextDue) ? 'skip' : 'send'
    case 'checkin':
    case 'resume':
    case 'cancelTrigger':
      return d.status === 'active' && d.nextCheckinDue >= Number(a.nextDue) ? 'skip' : 'send'
    case 'pause':
      return d.status === 'paused' && d.pausedUntil === Number(a.pausedUntil) ? 'skip' : 'send'
    case 'deactivate':
      return d.status === 'inactive' ? 'skip' : 'send'
    case 'trigger':
      if (d.status === 'triggered' || d.status === 'completed') return 'skip'
      return (await svc.triggerable(row.subject as Hex)) ? 'send' : 'wait'
    case 'complete':
      return d.status === 'completed' ? 'skip' : 'send'
    default:
      return 'send'
  }
}

async function afterConfirmed(row: Row, txHash: Hex, blockNumber: bigint, now: Date): Promise<void> {
  const subject = row.subject
  switch (row.action) {
    case 'register':
      await prisma().transmission_configs.updateMany({ where: { chain_subject: subject }, data: { contract_registered: true, chain_registered_at: now } })
      return
    case 'checkin':
      if (row.ref_id) await prisma().checkin_log.updateMany({ where: { id: row.ref_id }, data: { arbitrum_tx_hash: txHash } })
      return
    case 'trigger':
      if (row.ref_id) await prisma().transmissions.updateMany({ where: { id: row.ref_id }, data: { arbitrum_trigger_block: blockNumber.toString() } })
      return
    case 'deactivate':
    case 'complete':
      await prisma().transmission_configs.updateMany({ where: { chain_subject: subject }, data: { contract_registered: false, chain_registered_at: null } })
      return
    default:
      return
  }
}

async function processRow(svc: ChainService, row: Row, now: Date): Promise<keyof DrainResult> {
  const d = await svc.readDms(row.subject as Hex)
  const v = await verdict(svc, row, d)
  if (v === 'skip') {
    await prisma().chain_sync.update({ where: { id: row.id }, data: { status: 'skipped', updated_at: now } })
    return 'skipped'
  }
  if (v === 'wait') {
    await prisma().chain_sync.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, updated_at: now } })
    return 'waiting'
  }
  await prisma().chain_sync.update({ where: { id: row.id }, data: { status: 'sent', attempts: { increment: 1 }, updated_at: now } })
  try {
    const { txHash, blockNumber } = await svc.write(toCall(row))
    await prisma().chain_sync.update({ where: { id: row.id }, data: { status: 'confirmed', tx_hash: txHash, block_number: blockNumber, error: null, updated_at: now } })
    await afterConfirmed(row, txHash, blockNumber, now)
    return 'confirmed'
  } catch (err) {
    if (err instanceof ChainRevertError) {
      // Déterministe : rejouer ne changera rien. La réconciliation le verra.
      await prisma().chain_sync.update({ where: { id: row.id }, data: { status: 'failed', error: err.reason, updated_at: now } })
      logger().warn({ action: row.action, reason: err.reason }, 'chaîne : écriture refusée par le contrat')
      return 'failed'
    }
    // Réseau, RPC, gaz : la ligne reste en file et repassera au prochain tick.
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err)
    await prisma().chain_sync.update({ where: { id: row.id }, data: { status: 'queued', error: message, updated_at: now } })
    logger().warn({ action: row.action, err: message }, 'chaîne : écriture différée')
    return 'waiting'
  }
}

/** Traite les lignes `queued`, dans l'ordre, un sujet à la fois — les lignes d'un sujet en attente attendent avec lui. */
export async function drainChainQueue(now = new Date()): Promise<DrainResult> {
  const result: DrainResult = { confirmed: 0, skipped: 0, failed: 0, waiting: 0 }
  const svc = chainService()
  if (!svc.enabled) return result
  const rows = await prisma().chain_sync.findMany({
    where: { status: 'queued' },
    orderBy: { created_at: 'asc' },
    take: DRAIN_LIMIT,
    select: { id: true, subject: true, action: true, args: true, user_id: true, ref_id: true, attempts: true },
  })
  const held = new Set<string>()
  for (const row of rows) {
    if (held.has(row.subject)) {
      result.waiting++
      continue
    }
    const outcome = await processRow(svc, row, now)
    result[outcome]++
    if (outcome === 'waiting') held.add(row.subject)
  }
  if (rows.length > 0) await recordBalance(svc)
  return result
}
