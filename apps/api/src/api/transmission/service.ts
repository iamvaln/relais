// Transmission — configuration du dead man's switch et des trusted contacts
// (Backend Specs §3.4, Specs Techniques §4.3, DEC-12, DEC-20, DEC-23).

import { decodeBase64, ed25519Verify, sha256Hex } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import sodium from '../../lib/sodium.js'
import { relaisKeypair } from '../../services/secrets/index.js'
import type { ConfigBody, ContactBody, Roles, SchemaBody } from './schemas.js'

// --- Vues -----------------------------------------------------------------------

export interface ContactView {
  id: string
  position: number
  roles: Roles
  question_ids: [string, string, string]
  status: string
  /** Une part Shamir est-elle déposée pour chaque rôle ? (posé à l'activation) */
  shares: Roles
  verify_last_checked_at: string | null
}

export interface TransmissionConfigView {
  status: string
  schema: { n: number; m: number }
  silence_duration_months: number
  checkin_frequency_weeks: number
  pause_until: string | null
  activated_at: string | null
  contacts: ContactView[]
}

const contactSelect = {
  id: true,
  contact_order: true,
  has_k1_role: true,
  has_k2_role: true,
  has_k3_role: true,
  question_1_id: true,
  question_2_id: true,
  question_3_id: true,
  contact_status: true,
  storj_k1_path: true,
  storj_k2_path: true,
  storj_k3_path: true,
  verify_last_checked_at: true,
} as const

type ContactRow = {
  id: string
  contact_order: number
  has_k1_role: boolean
  has_k2_role: boolean
  has_k3_role: boolean
  question_1_id: string
  question_2_id: string
  question_3_id: string
  contact_status: string
  storj_k1_path: string | null
  storj_k2_path: string | null
  storj_k3_path: string | null
  verify_last_checked_at: Date | null
}

function toContactView(c: ContactRow): ContactView {
  return {
    id: c.id,
    position: c.contact_order,
    roles: { k1: c.has_k1_role, k2: c.has_k2_role, k3: c.has_k3_role },
    question_ids: [c.question_1_id, c.question_2_id, c.question_3_id],
    status: c.contact_status,
    shares: { k1: c.storj_k1_path !== null, k2: c.storj_k2_path !== null, k3: c.storj_k3_path !== null },
    verify_last_checked_at: c.verify_last_checked_at?.toISOString() ?? null,
  }
}

// --- Configuration ---------------------------------------------------------------

export async function getConfig(userId: string): Promise<TransmissionConfigView> {
  const cfg = await prisma().transmission_configs.findUnique({
    where: { user_id: userId },
    include: { trusted_contacts: { where: { contact_status: { not: 'removed' } }, orderBy: { contact_order: 'asc' }, select: contactSelect } },
  })
  return {
    status: cfg?.status ?? 'inactive',
    schema: { n: cfg?.schema_n ?? 2, m: cfg?.schema_m ?? 2 },
    silence_duration_months: cfg?.silence_duration_months ?? 3,
    checkin_frequency_weeks: cfg?.checkin_frequency_weeks ?? 4,
    pause_until: cfg?.pause_until?.toISOString() ?? null,
    activated_at: cfg?.activated_at?.toISOString() ?? null,
    contacts: (cfg?.trusted_contacts ?? []).map(toContactView),
  }
}

/** La ligne transmission_configs est créée inactive à la première écriture. */
async function ensureConfig(userId: string): Promise<{ id: string }> {
  return prisma().transmission_configs.upsert({
    where: { user_id: userId },
    create: { user_id: userId },
    update: {},
    select: { id: true },
  })
}

// --- Règles de validation (Note-01, BO-05) --------------------------------------

const DEFAULT_QUESTION_MIN_SCORE = 6

async function configInt(key: string, fallback: number): Promise<number> {
  const row = await prisma().app_config.findUnique({ where: { key }, select: { value: true } })
  const n = row ? Number.parseInt(row.value, 10) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

/**
 * Note-01 : les trois questions doivent exister, être distinctes, actives, de
 * type secret_question ou both, et scorer ≥ vault.question_min_score. La
 * contrainte n'est pas exprimable en SQL — elle vit ici.
 */
async function validateQuestions(ids: [string, string, string]): Promise<void> {
  const bad = new Set<string>()
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) bad.add(id)
    seen.add(id)
  }

  const minScore = await configInt('vault.question_min_score', DEFAULT_QUESTION_MIN_SCORE)
  const rows = await prisma().checkin_questions.findMany({
    where: { id: { in: [...seen] } },
    select: { id: true, usage_type: true, status: true, reliability_score: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const id of seen) {
    const q = byId.get(id)
    if (!q || q.status !== 'active' || q.usage_type === 'journal' || q.reliability_score < minScore) bad.add(id)
  }

  if (bad.size > 0) {
    throw new AppError('VALIDATION_ERROR', {
      message: 'Questions secrètes invalides.',
      details: { question_ids: [...bad] },
    })
  }
}

const PLAN_LIMITS = {
  free: { key: 'vault.free_max_contacts', fallback: 2 },
  premium: { key: 'vault.premium_max_contacts', fallback: 5 },
} as const

async function assertPlanAllowsOneMore(transmissionId: string, plan: string): Promise<void> {
  const limit = plan === 'premium' ? PLAN_LIMITS.premium : PLAN_LIMITS.free
  const max = await configInt(limit.key, limit.fallback)
  const current = await prisma().trusted_contacts.count({
    where: { transmission_id: transmissionId, contact_status: { not: 'removed' } },
  })
  if (current >= max) {
    throw new AppError('PLAN_LIMIT_REACHED', {
      message: `Votre plan autorise ${max} contact(s) de confiance.`,
      details: { max_contacts: max, plan },
    })
  }
}

/** L'owner doit avoir enregistré sa clé Ed25519 (POST /auth/keys) : elle authentifie chaque contact. */
async function ownerKey(userId: string): Promise<{ plan: string; ed25519Pk: Buffer }> {
  const user = await prisma().users.findUnique({ where: { id: userId }, select: { plan: true, ed25519_pk: true } })
  if (!user) throw new AppError('NOT_FOUND')
  if (!user.ed25519_pk) throw new AppError('AUTH_KEY_NOT_SET')
  return { plan: user.plan, ed25519Pk: Buffer.from(user.ed25519_pk) }
}

/** DEC-29 : Ed25519.verify(notification_sig, notification_enc, ed25519_pk). */
function verifyNotificationSig(ed25519Pk: Buffer, notificationEnc: Uint8Array, sig: Uint8Array): void {
  if (!ed25519Verify(ed25519Pk, Buffer.from(notificationEnc), Buffer.from(sig))) {
    throw new AppError('AUTH_TOKEN_INVALID', { message: 'Signature du contact invalide.' })
  }
}

/**
 * DEC-28 : la sealed box doit s'ouvrir avec la clé de Relais — sinon, au
 * décès, personne ne pourra prévenir ce contact. On vérifie sans conserver
 * le clair.
 */
async function assertSealedBoxOpens(notificationEnc: Uint8Array): Promise<void> {
  await sodium.ready
  const { publicKey, privateKey } = await relaisKeypair()
  try {
    sodium.crypto_box_seal_open(notificationEnc, publicKey, privateKey)
  } catch {
    throw new AppError('VALIDATION_ERROR', {
      details: { notification_enc: 'sealed box illisible avec la clé de Relais (GET /transmission/relais-key)' },
    })
  }
}

function validateRoles(roles: Roles): void {
  if (!roles.k1 && !roles.k2 && !roles.k3) {
    throw new AppError('VALIDATION_ERROR', { details: { roles: 'au moins un rôle (k1, k2 ou k3)' } })
  }
}

// --- Contacts ----------------------------------------------------------------------

// Prisma 6 attend Uint8Array<ArrayBuffer> pour les colonnes Bytes ; Buffer
// est typé sur ArrayBufferLike — d'où la copie explicite.
function decodeOrThrow(field: string, value: string): Uint8Array<ArrayBuffer> {
  const bytes = decodeBase64(value)
  if (!bytes || bytes.length === 0) throw new AppError('VALIDATION_ERROR', { details: { [field]: 'base64 invalide ou vide' } })
  return new Uint8Array(bytes)
}

interface ValidatedContact {
  notificationEnc: Uint8Array<ArrayBuffer>
  notificationSig: Uint8Array<ArrayBuffer>
  secretEnc: Uint8Array<ArrayBuffer>
  plan: string
}

/** Règles communes à POST et PUT : décodage, rôles, questions, clé de l'owner, signature, sealed box. */
async function validateContactInput(userId: string, body: ContactBody): Promise<ValidatedContact> {
  const notificationEnc = decodeOrThrow('notification_enc', body.notification_enc)
  const notificationSig = decodeOrThrow('notification_sig', body.notification_sig)
  const secretEnc = decodeOrThrow('secret_enc', body.secret_enc)
  validateRoles(body.roles)
  await validateQuestions(body.question_ids)

  const { plan, ed25519Pk } = await ownerKey(userId)
  verifyNotificationSig(ed25519Pk, notificationEnc, notificationSig)
  await assertSealedBoxOpens(notificationEnc)
  return { notificationEnc, notificationSig, secretEnc, plan }
}

function contactColumns(body: ContactBody, v: ValidatedContact) {
  return {
    notification_enc: v.notificationEnc,
    notification_sig: v.notificationSig,
    notification_hash: sha256Hex(Buffer.concat([Buffer.from(v.notificationEnc), Buffer.from(v.notificationSig)])),
    secret_enc: v.secretEnc,
    has_k1_role: body.roles.k1,
    has_k2_role: body.roles.k2,
    has_k3_role: body.roles.k3,
    question_1_id: body.question_ids[0],
    question_2_id: body.question_ids[1],
    question_3_id: body.question_ids[2],
  }
}

export async function createContact(userId: string, body: ContactBody): Promise<ContactView> {
  const v = await validateContactInput(userId, body)

  const cfg = await ensureConfig(userId)
  await assertPlanAllowsOneMore(cfg.id, v.plan)
  const last = await prisma().trusted_contacts.aggregate({ where: { transmission_id: cfg.id }, _max: { contact_order: true } })
  const position = (last._max.contact_order ?? 0) + 1

  const row = await prisma().trusted_contacts.create({
    data: { transmission_id: cfg.id, user_id: userId, contact_order: position, ...contactColumns(body, v) },
    select: contactSelect,
  })
  return toContactView(row)
}

/** Un contact vivant (non retiré) appartenant à l'utilisateur, sinon 404. */
async function findOwnContact(userId: string, id: string): Promise<{ id: string }> {
  const c = await prisma().trusted_contacts.findFirst({
    where: { id, user_id: userId, contact_status: { not: 'removed' } },
    select: { id: true },
  })
  if (!c) throw new AppError('NOT_FOUND', { message: 'Contact introuvable.' })
  return c
}

export async function updateContact(userId: string, id: string, body: ContactBody): Promise<ContactView> {
  await findOwnContact(userId, id)
  const v = await validateContactInput(userId, body)
  const row = await prisma().trusted_contacts.update({ where: { id }, data: contactColumns(body, v), select: contactSelect })
  return toContactView(row)
}

/** Retrait logique : la ligne reste (audit, positions), le contact sort de la config. */
export async function removeContact(userId: string, id: string): Promise<{ id: string; status: 'removed' }> {
  await findOwnContact(userId, id)
  await prisma().trusted_contacts.update({ where: { id }, data: { contact_status: 'removed' } })
  return { id, status: 'removed' }
}

// --- Schéma et délais ---------------------------------------------------------------

export async function updateSchema(userId: string, body: SchemaBody): Promise<TransmissionConfigView> {
  if (body.m < body.n) {
    throw new AppError('VALIDATION_ERROR', { details: { m: 'M doit être supérieur ou égal à N' } })
  }
  await ensureConfig(userId)
  await prisma().transmission_configs.update({ where: { user_id: userId }, data: { schema_n: body.n, schema_m: body.m } })
  return getConfig(userId)
}

export async function updateConfig(userId: string, body: ConfigBody): Promise<TransmissionConfigView> {
  await ensureConfig(userId)
  await prisma().transmission_configs.update({
    where: { user_id: userId },
    data: { silence_duration_months: body.silence_duration_months, checkin_frequency_weeks: body.checkin_frequency_weeks },
  })
  return getConfig(userId)
}
