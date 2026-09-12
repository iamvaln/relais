// Relay — transmission côté contact (Backend Specs §3.7, Techniques §6.7–6.8, E5).
//
// Ouverture : quand le dead man's switch a déclenché (transmission_configs
// 'triggered'), une ligne `transmissions` fige le schéma N-of-M et l'escrow,
// chaque contact vivant reçoit un token de relay (HMAC en base, 72 h) par
// email — l'adresse sort de la sealed box le temps de l'envoi (DEC-28/30).

import { env } from '../../config/env.js'
import { configInt } from '../../lib/app-config.js'
import { decodeBase64, hmacToken, randomToken, sha256Hex } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import sodium from '../../lib/sodium.js'
import { emailService } from '../../services/email/index.js'
import { objectStore } from '../../services/storage/index.js'
import { openNotification } from '../transmission/service.js'
import { vaultKey, vaultPrefix } from '../vault/service.js'
import type { VaultCategory } from '../vault/schemas.js'
import type { VerifyBody } from './schemas.js'

const HOUR_MS = 3600 * 1000
const DEFAULT_ESCROW_TTL_HOURS = 72

/** Crée la transmission d'une config déclenchée et prévient ses contacts. Retourne le nombre d'emails partis. */
export async function startTransmission(configId: string, now = new Date()): Promise<number> {
  const cfg = await prisma().transmission_configs.findUniqueOrThrow({
    where: { id: configId },
    include: {
      users: { select: { full_name: true, language: true } },
      trusted_contacts: { where: { contact_status: { not: 'removed' } }, orderBy: { contact_order: 'asc' } },
    },
  })
  const ttlHours = await configInt('dms.escrow_ttl_hours', DEFAULT_ESCROW_TTL_HOURS)
  const expiresAt = new Date(now.getTime() + ttlHours * HOUR_MS)

  const tokens: { contactId: string; token: string }[] = []
  await prisma().$transaction(async (tx) => {
    const tr = await tx.transmissions.create({
      data: {
        transmission_config_id: cfg.id,
        user_id: cfg.user_id,
        triggered_at: now,
        escrow_expires_at: expiresAt,
        schema_n_snapshot: cfg.schema_n,
        schema_m_snapshot: cfg.schema_m,
      },
      select: { id: true },
    })
    for (const c of cfg.trusted_contacts) {
      const token = randomToken(32)
      await tx.transmission_contacts.create({
        data: {
          transmission_id: tr.id,
          trusted_contact_id: c.id,
          relay_token_hash: hmacToken(token),
          relay_token_expires_at: expiresAt,
          notified_at: now,
        },
      })
      tokens.push({ contactId: c.id, token })
    }
  })

  // Emails hors transaction : un envoi qui échoue est tracé (email_log 'failed'), pas bloquant.
  let notified = 0
  const locale = cfg.users.language === 'en' ? 'en' : 'fr'
  for (const c of cfg.trusted_contacts) {
    const token = tokens.find((t) => t.contactId === c.id)!.token
    const { email } = await openNotification(c.notification_enc)
    const { sent } = await emailService().send({
      userId: cfg.user_id,
      to: email,
      type: 'transmission_contact',
      locale,
      params: { owner: cfg.users.full_name, link: `${env().FRONTEND_URL}/relay/${token}` },
    })
    if (sent) notified++
  }
  return notified
}

// --- Lecture du lien (GET /relay/:token) -------------------------------------------

const KEY_SLOTS = ['k1', 'k2', 'k3'] as const
export type KeySlot = (typeof KEY_SLOTS)[number]

const OPEN_STATUSES = new Set(['triggered', 'in_progress'])

const contactInclude = {
  transmissions: { include: { users: { select: { full_name: true, language: true } } } },
  trusted_contacts: {
    include: {
      checkin_questions_trusted_contacts_question_1_idTocheckin_questions: { select: { id: true, text_fr: true, text_en: true } },
      checkin_questions_trusted_contacts_question_2_idTocheckin_questions: { select: { id: true, text_fr: true, text_en: true } },
      checkin_questions_trusted_contacts_question_3_idTocheckin_questions: { select: { id: true, text_fr: true, text_en: true } },
    },
  },
} as const

type LoadedContact = NonNullable<Awaited<ReturnType<typeof findByToken>>>

async function findByToken(token: string) {
  return prisma().transmission_contacts.findUnique({ where: { relay_token_hash: hmacToken(token) }, include: contactInclude })
}

/**
 * Résout un token de relay : inconnu, expiré ou transmission close → 404
 * (même réponse, rien à apprendre) ; contact bloqué → 423 tant que
 * blocked_until n'est pas passé, puis déblocage automatique (E5-US02, 24 h).
 */
export async function loadContact(token: string, now = new Date()): Promise<LoadedContact> {
  const c = await findByToken(token)
  if (!c || c.relay_token_expires_at < now || !OPEN_STATUSES.has(c.transmissions.status)) {
    throw new AppError('RELAY_TOKEN_INVALID')
  }
  if (c.blocked) {
    const until = c.trusted_contacts.blocked_until
    if (until && until > now) throw new AppError('RELAY_CONTACT_BLOCKED', { details: { blocked_until: until.toISOString() } })
    await prisma().$transaction([
      prisma().transmission_contacts.update({ where: { id: c.id }, data: { blocked: false, fail_count: 0, status: 'notified' } }),
      prisma().trusted_contacts.update({ where: { id: c.trusted_contact_id }, data: { blocked_until: null, fail_count: 0 } }),
    ])
    c.blocked = false
    c.fail_count = 0
    c.status = 'notified'
  }
  return c
}

export interface RelayLinkView {
  owner_name: string
  status: string
  contact_status: string
  schema: { n: number; m: number }
  answered: number
  roles: Record<KeySlot, boolean>
  questions: { id: string; text_fr: string; text_en: string }[]
  verify_token: string | null
  shares_enc: Record<KeySlot, string | null>
  secret_enc: string
  expires_at: string
  escrow_expires_at: string
}

function b64(bytes: Uint8Array | null | undefined): string | null {
  return bytes ? Buffer.from(bytes).toString('base64') : null
}

async function answeredCount(transmissionId: string): Promise<number> {
  return prisma().transmission_contacts.count({ where: { transmission_id: transmissionId, status: { in: ['answered', 'confirmed'] } } })
}

export async function readLink(token: string, now = new Date()): Promise<RelayLinkView> {
  const c = await loadContact(token, now)
  const tc = c.trusted_contacts
  const store = objectStore()
  const shareEnc = async (path: string | null): Promise<string | null> => (path ? b64(await store.get(path)) : null)

  return {
    owner_name: c.transmissions.users.full_name,
    status: c.transmissions.status,
    contact_status: c.status,
    schema: { n: c.transmissions.schema_n_snapshot, m: c.transmissions.schema_m_snapshot },
    answered: await answeredCount(c.transmission_id),
    roles: { k1: tc.has_k1_role, k2: tc.has_k2_role, k3: tc.has_k3_role },
    questions: [
      tc.checkin_questions_trusted_contacts_question_1_idTocheckin_questions,
      tc.checkin_questions_trusted_contacts_question_2_idTocheckin_questions,
      tc.checkin_questions_trusted_contacts_question_3_idTocheckin_questions,
    ],
    verify_token: b64(tc.verify_token),
    shares_enc: {
      k1: await shareEnc(tc.storj_k1_path),
      k2: await shareEnc(tc.storj_k2_path),
      k3: await shareEnc(tc.storj_k3_path),
    },
    secret_enc: b64(tc.secret_enc)!,
    expires_at: c.relay_token_expires_at.toISOString(),
    escrow_expires_at: c.transmissions.escrow_expires_at.toISOString(),
  }
}

// --- Réponses : tentatives et escrow (POST /relay/:token/verify) ------------------------

const MAX_ATTEMPTS = 5 // chk fail_count <= 5, security.contact_max_fail
const DEFAULT_LOCK_HOURS = 24
/** Une part Shamir GF(256) : 1 octet d'index + 32 octets (packages/crypto-core, Techniques §4). */
const SHARE_BYTES = 33

export type VerifyResult =
  | { accepted: false; attempts_left: number }
  | { accepted: true; answered: number; needed: number; unlocked: Record<KeySlot, boolean> }

/** Une tentative de plus ; à la cinquième, blocage 24 h (E5-US02) et 429. */
/**
 * Proposal-9 : prévenir les autres contacts (non bloqués) d'un blocage
 * (E5-US02) ou d'une confirmation (E5-US03). Rien de personnel dans l'email :
 * l'événement seulement.
 */
async function notifyOtherContacts(c: LoadedContact, event: 'blocked' | 'confirmed'): Promise<void> {
  const others = await prisma().transmission_contacts.findMany({
    where: { transmission_id: c.transmission_id, id: { not: c.id }, blocked: false },
    select: { trusted_contacts: { select: { notification_enc: true } } },
  })
  const locale = c.transmissions.users.language === 'en' ? 'en' : 'fr'
  for (const other of others) {
    const { email } = await openNotification(other.trusted_contacts.notification_enc)
    await emailService().send({ userId: c.transmissions.user_id, to: email, type: 'contact_progress', locale, params: { event } })
  }
}

async function recordFailure(c: LoadedContact, now: Date): Promise<never | { attempts_left: number }> {
  const count = c.fail_count + 1
  if (count >= MAX_ATTEMPTS) {
    const lockHours = await configInt('security.contact_lock_hrs', DEFAULT_LOCK_HOURS)
    const until = new Date(now.getTime() + lockHours * HOUR_MS)
    await prisma().$transaction([
      prisma().transmission_contacts.update({ where: { id: c.id }, data: { fail_count: count, blocked: true, status: 'failed' } }),
      prisma().trusted_contacts.update({ where: { id: c.trusted_contact_id }, data: { fail_count: count, blocked_until: until } }),
    ])
    await notifyOtherContacts(c, 'blocked')
    throw new AppError('RELAY_TOKEN_EXHAUSTED', { details: { blocked_until: until.toISOString() } })
  }
  await prisma().$transaction([
    prisma().transmission_contacts.update({ where: { id: c.id }, data: { fail_count: count } }),
    prisma().trusted_contacts.update({ where: { id: c.trusted_contact_id }, data: { fail_count: count } }),
  ])
  return { attempts_left: MAX_ATTEMPTS - count }
}

/** Les parts attendues : exactement une par rôle détenu, 33 bytes chacune (index + 32). */
function decodeShares(c: LoadedContact, shares: VerifyBody['shares']): Map<KeySlot, Uint8Array> {
  const held: Record<KeySlot, boolean> = { k1: c.trusted_contacts.has_k1_role, k2: c.trusted_contacts.has_k2_role, k3: c.trusted_contacts.has_k3_role }
  const out = new Map<KeySlot, Uint8Array>()
  for (const slot of KEY_SLOTS) {
    const raw = shares?.[slot]
    if (held[slot] !== (raw !== undefined)) {
      throw new AppError('VALIDATION_ERROR', { details: { [`shares.${slot}`]: held[slot] ? 'part attendue pour ce rôle' : 'rôle non détenu' } })
    }
    if (raw === undefined) continue
    const bytes = decodeBase64(raw)
    if (!bytes || bytes.length !== SHARE_BYTES) {
      throw new AppError('VALIDATION_ERROR', { details: { [`shares.${slot}`]: `${SHARE_BYTES} bytes attendus` } })
    }
    out.set(slot, new Uint8Array(bytes))
  }
  return out
}

export function escrowKeyId(transmissionId: string): string {
  return `escrow:key:${transmissionId}`
}

const ACCESS_DAYS = 30

/** Fin de l'accès aux données déverrouillées : escrow + 30 jours (E5-US04). */
export function accessExpiresAt(escrowExpiresAt: Date): Date {
  return new Date(escrowExpiresAt.getTime() + ACCESS_DAYS * 24 * HOUR_MS)
}

/** Clé éphémère de l'escrow : créée au premier dépôt, expire avec l'escrow (Redis fait le ménage). */
async function escrowKey(transmissionId: string, expiresAt: Date, now: Date): Promise<Uint8Array> {
  await sodium.ready
  const id = escrowKeyId(transmissionId)
  const existing = await redis().get(id)
  if (existing) return new Uint8Array(Buffer.from(existing, 'hex'))
  const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)
  const ttl = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000))
  const stored = await redis().set(id, Buffer.from(key).toString('hex'), 'EX', ttl, 'NX')
  if (stored === 'OK') return key
  return new Uint8Array(Buffer.from((await redis().get(id))!, 'hex'))
}

/** XChaCha20-Poly1305 (secretbox) : nonce || ciphertext. */
function sealShare(key: Uint8Array, share: Uint8Array): Uint8Array<ArrayBuffer> {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const boxed = sodium.crypto_secretbox_easy(share, nonce, key)
  return new Uint8Array(Buffer.concat([Buffer.from(nonce), Buffer.from(boxed)]))
}

async function unlockedSlots(transmissionId: string, needed: number): Promise<Record<KeySlot, boolean>> {
  const counts = await prisma().escrow_shares.groupBy({ by: ['key_category'], where: { transmission_id: transmissionId }, _count: { _all: true } })
  const by = new Map(counts.map((r) => [r.key_category, r._count._all]))
  return { k1: (by.get('k1') ?? 0) >= needed, k2: (by.get('k2') ?? 0) >= needed, k3: (by.get('k3') ?? 0) >= needed }
}

export async function verify(token: string, body: VerifyBody, now = new Date()): Promise<VerifyResult> {
  const c = await loadContact(token, now)
  if (c.status === 'answered' || c.status === 'confirmed') throw new AppError('RELAY_ALREADY_ANSWERED')

  if (body.failed === true && body.shares === undefined) {
    return { accepted: false, ...(await recordFailure(c, now)) }
  }
  if (body.failed !== undefined || body.shares === undefined) {
    await recordFailure(c, now)
    throw new AppError('VALIDATION_ERROR', { details: { body: 'soit { failed: true }, soit { shares }' } })
  }

  let shares: Map<KeySlot, Uint8Array>
  try {
    shares = decodeShares(c, body.shares)
  } catch (err) {
    await recordFailure(c, now)
    throw err
  }

  // Proposal-8 : la part déposée doit être celle que l'owner a hachée et
  // signée à l'activation — une part fausse se voit ici, pas au déchiffrement
  // final quand l'escrow est consommé. Elle compte comme un échec.
  const expected: Record<KeySlot, string | null> = {
    k1: c.trusted_contacts.share_k1_plain_hash,
    k2: c.trusted_contacts.share_k2_plain_hash,
    k3: c.trusted_contacts.share_k3_plain_hash,
  }
  for (const [slot, share] of shares) {
    if (expected[slot] !== null && sha256Hex(Buffer.from(share)) !== expected[slot]) {
      const failure = await recordFailure(c, now)
      throw new AppError('RELAY_SHARE_INVALID', { details: { ...failure, slot } })
    }
  }

  const tr = c.transmissions
  const key = await escrowKey(tr.id, tr.escrow_expires_at, now)
  await prisma().$transaction([
    ...[...shares].map(([slot, share]) =>
      prisma().escrow_shares.upsert({
        where: { transmission_contact_id_key_category: { transmission_contact_id: c.id, key_category: slot } },
        create: {
          transmission_id: tr.id,
          transmission_contact_id: c.id,
          key_category: slot,
          share_tmp_enc: sealShare(key, share),
          redis_key_id: escrowKeyId(tr.id),
          expires_at: tr.escrow_expires_at,
        },
        update: { share_tmp_enc: sealShare(key, share) },
      }),
    ),
    prisma().transmission_contacts.update({ where: { id: c.id }, data: { status: 'answered', answered_at: now, relay_token_used: true } }),
  ])

  const needed = tr.schema_n_snapshot
  const unlocked = await unlockedSlots(tr.id, needed)
  await prisma().transmissions.update({
    where: { id: tr.id },
    data: { status: 'in_progress', k1_completed: unlocked.k1, k2_completed: unlocked.k2, k3_completed: unlocked.k3 },
  })
  if (unlocked.k1 || unlocked.k2 || unlocked.k3) {
    // E5-US04 : l'accès dure 30 jours au-delà de l'escrow — la clé éphémère doit y survivre.
    const accessEnd = accessExpiresAt(tr.escrow_expires_at)
    await redis().expire(escrowKeyId(tr.id), Math.max(1, Math.ceil((accessEnd.getTime() - now.getTime()) / 1000)))
  }
  return { accepted: true, answered: await answeredCount(tr.id), needed, unlocked }
}

// --- Statut (GET /relay/:token/status) --------------------------------------------------

export interface RelayStatusView {
  status: string
  contact_status: string
  answered: number
  needed: number
  total: number
  unlocked: Record<KeySlot, boolean>
  escrow_expires_at: string
}

export async function status(token: string, now = new Date()): Promise<RelayStatusView> {
  const c = await loadContact(token, now)
  const tr = c.transmissions
  return {
    status: tr.status,
    contact_status: c.status,
    answered: await answeredCount(tr.id),
    needed: tr.schema_n_snapshot,
    total: tr.schema_m_snapshot,
    unlocked: { k1: tr.k1_completed, k2: tr.k2_completed, k3: tr.k3_completed },
    escrow_expires_at: tr.escrow_expires_at.toISOString(),
  }
}

// --- Données (GET /relay/:token/data) --------------------------------------------------

/** K1 → comptes & accès, K2 → souvenirs, K3 → finances (Techniques §4). */
const SLOT_CATEGORY: Record<KeySlot, VaultCategory> = { k1: 'accounts', k2: 'messages', k3: 'finances' }

export interface RelayJournalEntryView {
  month: string
  mode: string
  /** XChaCha20(K2, { question_id, mois, mode, texte }) — le contact le lit une fois K2 reconstituée. */
  content_enc: string
}

export interface RelayDataView {
  secret_enc: string
  categories: Partial<Record<KeySlot, { category: VaultCategory; shares: string[]; p2: string | null }>>
  /** E2-US07 : le carnet de vie, pour le Gardien du souvenir (K2) seulement. */
  journal?: RelayJournalEntryView[]
}

function openShare(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  const n = sodium.crypto_secretbox_NONCEBYTES
  return sodium.crypto_secretbox_open_easy(sealed.subarray(n), sealed.subarray(0, n), key)
}

/**
 * Les N parts d'une catégorie déverrouillée, déchiffrées de l'escrow, plus
 * P2 : la reconstitution Shamir et le déchiffrement final se font sur le
 * device du contact (§6.8). Le serveur ne combine jamais les parts.
 */
export async function data(token: string, now = new Date()): Promise<RelayDataView> {
  const c = await loadContact(token, now)
  if (c.status !== 'answered' && c.status !== 'confirmed') throw new AppError('RELAY_NOT_UNLOCKED', { message: 'Répondez d’abord aux questions.' })
  const tr = c.transmissions
  const tc = c.trusted_contacts
  const held: Record<KeySlot, boolean> = { k1: tc.has_k1_role, k2: tc.has_k2_role, k3: tc.has_k3_role }
  const unlocked: Record<KeySlot, boolean> = { k1: tr.k1_completed, k2: tr.k2_completed, k3: tr.k3_completed }
  const slots = KEY_SLOTS.filter((s) => held[s] && unlocked[s])
  if (slots.length === 0) throw new AppError('RELAY_NOT_UNLOCKED')

  await sodium.ready
  const keyHex = await redis().get(escrowKeyId(tr.id))
  if (!keyHex) throw new AppError('RELAY_NOT_UNLOCKED', { message: 'L’escrow a expiré : les contacts doivent répondre de nouveau.' })
  const key = new Uint8Array(Buffer.from(keyHex, 'hex'))

  const rows = await prisma().escrow_shares.findMany({ where: { transmission_id: tr.id, key_category: { in: slots } }, orderBy: { created_at: 'asc' } })
  const store = objectStore()
  const categories: RelayDataView['categories'] = {}
  for (const slot of slots) {
    const p2 = await store.get(vaultKey(tr.user_id, SLOT_CATEGORY[slot]))
    categories[slot] = {
      category: SLOT_CATEGORY[slot],
      shares: rows.filter((r) => r.key_category === slot).map((r) => Buffer.from(openShare(key, r.share_tmp_enc)).toString('base64')),
      p2: b64(p2),
    }
  }
  const view: RelayDataView = { secret_enc: b64(tc.secret_enc)!, categories }
  if (slots.includes('k2')) {
    const entries = await prisma().journal_entries.findMany({
      where: { user_id: tr.user_id },
      orderBy: { entry_month: 'asc' },
      select: { entry_month: true, mode: true, content_enc: true },
    })
    view.journal = entries.map((e) => ({ month: e.entry_month.toISOString().slice(0, 10), mode: e.mode, content_enc: b64(e.content_enc)! }))
  }
  return view
}

// --- Confirmation et purge (POST /relay/:token/confirm) -------------------------------

export interface ConfirmResult {
  confirmed: true
  transmission_status: string
}

/**
 * E5-US05 : « J'ai terminé ». La transmission se termine quand chaque
 * contact ayant répondu a confirmé — alors tout est purgé (P2, Si_enc,
 * escrow, clé éphémère) et seul le log reste.
 */
export async function confirm(token: string, now = new Date()): Promise<ConfirmResult> {
  const c = await loadContact(token, now)
  if (c.status !== 'answered' && c.status !== 'confirmed') throw new AppError('RELAY_NOT_UNLOCKED', { message: 'Répondez d’abord aux questions.' })
  const tr = c.transmissions
  // Audit HIGH-1 : « J'ai terminé » n'a de sens qu'une fois l'accès ouvert. Sans
  // cette garde, le premier contact à répondre pouvait purger le coffre seul.
  const tc = c.trusted_contacts
  const held: Record<KeySlot, boolean> = { k1: tc.has_k1_role, k2: tc.has_k2_role, k3: tc.has_k3_role }
  const unlocked: Record<KeySlot, boolean> = { k1: tr.k1_completed, k2: tr.k2_completed, k3: tr.k3_completed }
  if (!KEY_SLOTS.some((s) => held[s] && unlocked[s])) throw new AppError('RELAY_NOT_UNLOCKED', { message: 'L’accès n’est pas encore ouvert.' })
  if (c.status === 'answered') {
    await prisma().transmission_contacts.update({ where: { id: c.id }, data: { status: 'confirmed', confirmed_at: now } })
  }
  const pending = await prisma().transmission_contacts.count({ where: { transmission_id: tr.id, status: 'answered' } })
  if (pending > 0) {
    if (c.status === 'answered') await notifyOtherContacts(c, 'confirmed')
    return { confirmed: true, transmission_status: tr.status }
  }

  await purgeTransmission(tr.id, tr.user_id, tr.transmission_config_id, now)
  return { confirmed: true, transmission_status: 'completed' }
}

/** Purge définitive : P2, Si_enc, escrow, clé éphémère ; statut completed des deux côtés. */
export async function purgeTransmission(transmissionId: string, userId: string, configId: string, now: Date): Promise<void> {
  const store = objectStore()
  await store.deletePrefix(vaultPrefix(userId))
  await store.deletePrefix(`shares/${userId}/`)
  await redis().del(escrowKeyId(transmissionId))
  await prisma().$transaction([
    prisma().escrow_shares.deleteMany({ where: { transmission_id: transmissionId } }),
    // E5-US05 / E2-US07 : le carnet et les rétrospectives sont des données chiffrées de l'owner, elles partent aussi.
    prisma().checkin_log.updateMany({ where: { user_id: userId }, data: { journal_entry_id: null } }),
    prisma().journal_entries.deleteMany({ where: { user_id: userId } }),
    prisma().annual_wrappeds.deleteMany({ where: { user_id: userId } }),
    prisma().trusted_contacts.updateMany({
      where: { transmission_id: configId },
      data: { storj_k1_path: null, storj_k2_path: null, storj_k3_path: null },
    }),
    prisma().transmissions.update({ where: { id: transmissionId }, data: { status: 'completed', completed_at: now } }),
    prisma().transmission_configs.update({ where: { id: configId }, data: { status: 'completed' } }),
  ])
}
