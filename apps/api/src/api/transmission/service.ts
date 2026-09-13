// Transmission — configuration du dead man's switch et des trusted contacts
// (Backend Specs §3.4, Specs Techniques §4.3, DEC-12, DEC-20, DEC-23).

import { configInt } from '../../lib/app-config.js'
import { decodeBase64, ed25519Verify, randomToken, sha256Hex } from '../../lib/crypto.js'
import { keys as redisKeys, redis } from '../../lib/redis.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import sodium from '../../lib/sodium.js'
import { relaisKeypair } from '../../services/secrets/index.js'
import { env } from '../../config/env.js'
import { emailService } from '../../services/email/index.js'
import { objectStore } from '../../services/storage/index.js'
import type { ActivateBody, ActivateContact, ConfigBody, ContactBody, PauseBody, Roles, SchemaBody } from './schemas.js'
import { DAY_S } from '../../services/chain/message.js'
import { prepareChainAction, type ChainContext } from '../../services/chain/sync.js'
import type { ChainField } from '../../services/chain/schema.js'

// --- Vues -----------------------------------------------------------------------

export interface ContactView {
  id: string
  position: number
  roles: Roles
  question_ids: [string, string, string]
  status: string
  /** Une part Shamir est-elle déposée pour chaque rôle ? (posé à l'activation) */
  shares: Roles
  /** XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1'), posé à l'activation — sert à la vérification annuelle côté app. */
  verify_token: string | null
  verify_last_checked_at: string | null
  /** XChaCha20(K2, { nom, role, message_personnel, email, phone }) — opaque pour le serveur, relu par l'owner sur un nouveau device. */
  secret_enc: string
}

const WEEK_MS = 7 * 24 * 3600 * 1000
const DAY_MS = 24 * 3600 * 1000
const MONTH_DAYS = 30

/** Contexte de la chaîne pour un owner : sujet et enregistrement déjà posés, clé publique. */
export async function chainContext(userId: string, ed25519Pk?: Buffer): Promise<ChainContext> {
  const cfg = await prisma().transmission_configs.findUnique({ where: { user_id: userId }, select: { chain_subject: true, chain_registered_at: true, users: { select: { ed25519_pk: true } } } })
  const pk = ed25519Pk ?? (cfg?.users.ed25519_pk ? Buffer.from(cfg.users.ed25519_pk) : null)
  return { chainSubject: cfg?.chain_subject ?? null, chainRegisteredAt: cfg?.chain_registered_at ?? null, ed25519Pk: pk }
}

export interface TransmissionConfigView {
  status: string
  schema: { n: number; m: number }
  silence_duration_months: number
  checkin_frequency_weeks: number
  pause_until: string | null
  activated_at: string | null
  contacts: ContactView[]
  /** Lot 2a : le pseudonyme on-chain et la date de l'enregistrement confirmé (null tant que rien n'est écrit). */
  chain: { subject: string | null; registered_at: string | null }
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
  verify_token: true,
  verify_last_checked_at: true,
  secret_enc: true,
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
  verify_token: Uint8Array | null
  verify_last_checked_at: Date | null
  secret_enc: Uint8Array
}

function toContactView(c: ContactRow): ContactView {
  return {
    id: c.id,
    position: c.contact_order,
    roles: { k1: c.has_k1_role, k2: c.has_k2_role, k3: c.has_k3_role },
    question_ids: [c.question_1_id, c.question_2_id, c.question_3_id],
    status: c.contact_status,
    shares: { k1: c.storj_k1_path !== null, k2: c.storj_k2_path !== null, k3: c.storj_k3_path !== null },
    verify_token: c.verify_token ? Buffer.from(c.verify_token).toString('base64') : null,
    verify_last_checked_at: c.verify_last_checked_at?.toISOString() ?? null,
    secret_enc: Buffer.from(c.secret_enc).toString('base64'),
  }
}

// --- Bibliothèque des questions secrètes (BO-04) -------------------------------------

export interface SecretQuestionView {
  id: string
  text_fr: string
  text_en: string
  category: string
  reliability_score: number
}

/** Les questions que l'owner peut choisir : mêmes critères que validateQuestions, groupées par catégorie, les plus solides d'abord. */
export async function listSecretQuestions(): Promise<{ questions: SecretQuestionView[] }> {
  const minScore = await configInt('vault.question_min_score', DEFAULT_QUESTION_MIN_SCORE)
  const questions = await prisma().checkin_questions.findMany({
    where: { status: 'active', usage_type: { in: ['secret_question', 'both'] }, reliability_score: { gte: minScore } },
    orderBy: [{ category: 'asc' }, { reliability_score: 'desc' }, { text_fr: 'asc' }],
    select: { id: true, text_fr: true, text_en: true, category: true, reliability_score: true },
  })
  return { questions }
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
    chain: { subject: cfg?.chain_subject ?? null, registered_at: cfg?.chain_registered_at?.toISOString() ?? null },
  }
}

/** La ligne transmission_configs est créée inactive à la première écriture. */
async function ensureConfig(userId: string): Promise<{ id: string; status: string }> {
  return prisma().transmission_configs.upsert({
    where: { user_id: userId },
    create: { user_id: userId },
    update: {},
    select: { id: true, status: true },
  })
}

/** Contacts et schéma sont figés dès l'activation : les parts Shamir en dépendent. */
function assertEditable(status: string): void {
  if (status !== 'inactive') {
    throw new AppError('TRANSMISSION_ALREADY_ACTIVE', {
      message: 'Transmission active : désactivez-la avant de modifier contacts ou schéma.',
    })
  }
}

// --- Règles de validation (Note-01, BO-05) --------------------------------------

const DEFAULT_QUESTION_MIN_SCORE = 6

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
interface OwnerKey {
  plan: string
  language: 'fr' | 'en'
  ed25519Pk: Buffer
}

async function ownerKey(userId: string): Promise<OwnerKey> {
  const user = await prisma().users.findUnique({
    where: { id: userId },
    select: { plan: true, language: true, ed25519_pk: true },
  })
  if (!user) throw new AppError('NOT_FOUND')
  if (!user.ed25519_pk) throw new AppError('AUTH_KEY_NOT_SET')
  return { plan: user.plan, language: user.language === 'en' ? 'en' : 'fr', ed25519Pk: Buffer.from(user.ed25519_pk) }
}

/** DEC-29 : Ed25519.verify(notification_sig, notification_enc, ed25519_pk). */
function verifyNotificationSig(ed25519Pk: Buffer, notificationEnc: Uint8Array, sig: Uint8Array): void {
  if (!ed25519Verify(ed25519Pk, Buffer.from(notificationEnc), Buffer.from(sig))) {
    throw new AppError('AUTH_TOKEN_INVALID', { message: 'Signature du contact invalide.' })
  }
}

export interface Notification {
  email: string
  phone: string | null
  /** Prénom que l'owner veut voir dans l'email de désignation (D.2) — même niveau de confidentialité que l'email (DEC-12). */
  ownerDisplayName: string | null
}

const DISPLAY_NAME_MAX = 60

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * DEC-28 : la sealed box doit s'ouvrir avec la clé de Relais et contenir un
 * email — sinon, le moment venu, personne ne pourra prévenir ce contact. Le
 * clair n'est jamais conservé ni loggé ; il ne sert qu'à envoyer l'email.
 */
export async function openNotification(notificationEnc: Uint8Array): Promise<Notification> {
  await sodium.ready
  const { publicKey, privateKey } = await relaisKeypair()
  const reject = (why: string): never => {
    throw new AppError('VALIDATION_ERROR', { details: { notification_enc: why } })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(sodium.crypto_box_seal_open(notificationEnc, publicKey, privateKey)).toString('utf8'))
  } catch {
    return reject('sealed box illisible avec la clé de Relais (GET /transmission/relais-key)')
  }
  if (typeof parsed !== 'object' || parsed === null) return reject('doit sceller un objet { email, phone, owner_display_name? }')
  const { email, phone, owner_display_name } = parsed as { email?: unknown; phone?: unknown; owner_display_name?: unknown }
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) return reject('email manquant ou invalide dans la sealed box')
  const name = typeof owner_display_name === 'string' ? owner_display_name.trim().slice(0, DISPLAY_NAME_MAX) : ''
  return { email, phone: typeof phone === 'string' ? phone : null, ownerDisplayName: name.length > 0 ? name : null }
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
  notification: Notification
  owner: OwnerKey
}

/** Règles communes à POST, PUT et activate : décodage, rôles, questions, clé de l'owner, signature, sealed box. */
async function validateContactInput(userId: string, body: ContactBody, owner?: OwnerKey): Promise<ValidatedContact> {
  const notificationEnc = decodeOrThrow('notification_enc', body.notification_enc)
  const notificationSig = decodeOrThrow('notification_sig', body.notification_sig)
  const secretEnc = decodeOrThrow('secret_enc', body.secret_enc)
  validateRoles(body.roles)
  await validateQuestions(body.question_ids)

  const key = owner ?? (await ownerKey(userId))
  verifyNotificationSig(key.ed25519Pk, notificationEnc, notificationSig)
  const notification = await openNotification(notificationEnc)
  return { notificationEnc, notificationSig, secretEnc, notification, owner: key }
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
  assertEditable(cfg.status)
  await assertPlanAllowsOneMore(cfg.id, v.owner.plan)
  const last = await prisma().trusted_contacts.aggregate({ where: { transmission_id: cfg.id }, _max: { contact_order: true } })
  const position = (last._max.contact_order ?? 0) + 1

  const row = await prisma().trusted_contacts.create({
    data: { transmission_id: cfg.id, user_id: userId, contact_order: position, ...contactColumns(body, v) },
    select: contactSelect,
  })
  return toContactView(row)
}

/** Un contact vivant (non retiré) appartenant à l'utilisateur, sinon 404. */
async function findOwnContact(userId: string, id: string): Promise<{ id: string; status: string }> {
  const c = await prisma().trusted_contacts.findFirst({
    where: { id, user_id: userId, contact_status: { not: 'removed' } },
    select: { id: true, transmission_configs: { select: { status: true } } },
  })
  if (!c) throw new AppError('NOT_FOUND', { message: 'Contact introuvable.' })
  return { id: c.id, status: c.transmission_configs.status }
}

export async function updateContact(userId: string, id: string, body: ContactBody): Promise<ContactView> {
  assertEditable((await findOwnContact(userId, id)).status)
  const v = await validateContactInput(userId, body)
  const row = await prisma().trusted_contacts.update({ where: { id }, data: contactColumns(body, v), select: contactSelect })
  return toContactView(row)
}

/** Retrait logique : la ligne reste (audit, positions), le contact sort de la config. */
export async function removeContact(userId: string, id: string): Promise<{ id: string; status: 'removed' }> {
  assertEditable((await findOwnContact(userId, id)).status)
  await prisma().trusted_contacts.update({ where: { id }, data: { contact_status: 'removed' } })
  return { id, status: 'removed' }
}

// --- Schéma et délais ---------------------------------------------------------------

export async function updateSchema(userId: string, body: SchemaBody): Promise<TransmissionConfigView> {
  if (body.m < body.n) {
    throw new AppError('VALIDATION_ERROR', { details: { m: 'M doit être supérieur ou égal à N' } })
  }
  assertEditable((await ensureConfig(userId)).status)
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

// --- Activation (Backend §3.4, DEC-29, DEC-30) ----------------------------------------

const KEY_SLOTS = ['k1', 'k2', 'k3'] as const
type KeySlot = (typeof KEY_SLOTS)[number]

function sharePath(userId: string, contactId: string, slot: KeySlot): string {
  return `shares/${userId}/${contactId}/${slot}.enc`
}

interface PreparedShare {
  slot: KeySlot
  path: string
  bytes: Uint8Array<ArrayBuffer>
  hash: string
  /** SHA256(Si) signé par l'owner (Proposal-8). */
  plainHash: string
}

interface PreparedContact {
  id: string
  body: ActivateContact
  validated: ValidatedContact
  verifyToken: Uint8Array<ArrayBuffer>
  shares: PreparedShare[]
}

/**
 * DEC-29 : une part par rôle détenu, aucune pour les autres, chaque part
 * signée Ed25519 sur SHA256(Si_enc). Une seule signature invalide rejette
 * toute l'activation.
 */
function prepareShares(userId: string, c: ActivateContact, ed25519Pk: Buffer): PreparedShare[] {
  const out: PreparedShare[] = []
  for (const slot of KEY_SLOTS) {
    const held = c.roles[slot]
    const share = c.shares[slot]
    if (held && !share) {
      throw new AppError('VALIDATION_ERROR', { details: { contacts: { [c.id]: `part ${slot} manquante pour un rôle détenu` } } })
    }
    if (!held && share) {
      throw new AppError('VALIDATION_ERROR', { details: { contacts: { [c.id]: `part ${slot} fournie sans le rôle` } } })
    }
    if (!share) continue
    const bytes = decodeOrThrow(`shares.${slot}.enc`, share.enc)
    const sig = decodeOrThrow(`shares.${slot}.sig`, share.sig)
    const hash = sha256Hex(Buffer.from(bytes))
    if (!ed25519Verify(ed25519Pk, Buffer.from(hash, 'hex'), Buffer.from(sig))) {
      throw new AppError('AUTH_TOKEN_INVALID', { message: `Signature de la part ${slot} invalide.` })
    }
    const plainSig = decodeOrThrow(`shares.${slot}.plain_sig`, share.plain_sig)
    if (!ed25519Verify(ed25519Pk, Buffer.from(share.plain_hash, 'hex'), Buffer.from(plainSig))) {
      throw new AppError('AUTH_TOKEN_INVALID', { message: `Signature du hash en clair de la part ${slot} invalide.` })
    }
    out.push({ slot, path: sharePath(userId, c.id, slot), bytes, hash, plainHash: share.plain_hash })
  }
  return out
}

export async function activate(userId: string, body: ActivateBody): Promise<{ activated: true; contacts_notified: number }> {
  const cfg = await ensureConfig(userId)
  if (cfg.status !== 'inactive') throw new AppError('TRANSMISSION_ALREADY_ACTIVE')
  if (body.schema.m < body.schema.n) {
    throw new AppError('VALIDATION_ERROR', { details: { schema: 'M doit être supérieur ou égal à N' } })
  }

  // Le corps doit couvrir exactement les contacts vivants.
  const live = await prisma().trusted_contacts.findMany({
    where: { transmission_id: cfg.id, contact_status: { not: 'removed' } },
    select: { id: true },
  })
  const liveIds = new Set(live.map((c) => c.id))
  const bodyIds = body.contacts.map((c) => c.id)
  const missing = [...liveIds].filter((id) => !bodyIds.includes(id))
  const unknown = bodyIds.filter((id, i) => !liveIds.has(id) || bodyIds.indexOf(id) !== i)
  if (missing.length > 0 || unknown.length > 0) {
    throw new AppError('VALIDATION_ERROR', {
      message: 'Le corps doit reprendre chaque contact, une fois.',
      details: { contacts: { missing, unknown } },
    })
  }

  if (body.contacts.length < 2) notConfigured('Au moins deux contacts de confiance sont nécessaires.')
  if (body.schema.m > body.contacts.length) notConfigured('M ne peut pas dépasser le nombre de contacts.')
  if (!body.contacts.some((c) => c.roles.k1)) notConfigured('Au moins un contact doit détenir le rôle K1 (comptes & accès).')
  // Audit LOW-12 : le déverrouillage exige N parts par catégorie — un rôle
  // détenu par moins de N contacts ne s'ouvrirait jamais.
  for (const slot of KEY_SLOTS) {
    const holders = body.contacts.filter((c) => c.roles[slot]).length
    if (holders > 0 && holders < body.schema.n) {
      notConfigured(`Le rôle ${slot.toUpperCase()} est détenu par ${holders} contact(s) : il en faut au moins ${body.schema.n} (N) pour le déverrouiller.`)
    }
  }

  // Toutes les vérifications avant la moindre écriture.
  const owner = await ownerKey(userId)
  const chainNow = new Date()
  const chain = await prepareChainAction(body.chain, 'register', ['register'], await chainContext(userId, owner.ed25519Pk), {
    nextDue: new Date(chainNow.getTime() + body.checkin_frequency_weeks * WEEK_MS),
    n: body.schema.n,
    m: body.contacts.length,
    silenceSecs: body.silence_duration_months * MONTH_DAYS * DAY_S,
    checkinFreqSecs: body.checkin_frequency_weeks * 7 * DAY_S,
  })
  const prepared: PreparedContact[] = []
  for (const c of body.contacts) {
    const validated = await validateContactInput(userId, c, owner)
    prepared.push({ id: c.id, body: c, validated, verifyToken: decodeOrThrow('verify_token', c.verify_token), shares: prepareShares(userId, c, owner.ed25519Pk) })
  }

  // Dépôt des parts, puis bascule atomique en base.
  const store = objectStore()
  const written: string[] = []
  try {
    for (const p of prepared) {
      for (const s of p.shares) {
        await store.put(s.path, s.bytes)
        written.push(s.path)
      }
    }
    const now = new Date()
    const nextCheckin = new Date(now.getTime() + body.checkin_frequency_weeks * 7 * 24 * 3600 * 1000)
    await prisma().$transaction([
      ...prepared.map((p) => {
        const bySlot = (slot: KeySlot) => p.shares.find((s) => s.slot === slot)
        return prisma().trusted_contacts.update({
          where: { id: p.id },
          data: {
            ...contactColumns(p.body, p.validated),
            verify_token: p.verifyToken,
            storj_k1_path: bySlot('k1')?.path ?? null,
            storj_k2_path: bySlot('k2')?.path ?? null,
            storj_k3_path: bySlot('k3')?.path ?? null,
            share_k1_hash: bySlot('k1')?.hash ?? null,
            share_k2_hash: bySlot('k2')?.hash ?? null,
            share_k3_hash: bySlot('k3')?.hash ?? null,
            share_k1_plain_hash: bySlot('k1')?.plainHash ?? null,
            share_k2_plain_hash: bySlot('k2')?.plainHash ?? null,
            share_k3_plain_hash: bySlot('k3')?.plainHash ?? null,
          },
        })
      }),
      prisma().transmission_configs.update({
        where: { id: cfg.id },
        data: {
          status: 'active',
          activated_at: now,
          schema_n: body.schema.n,
          schema_m: body.schema.m,
          silence_duration_months: body.silence_duration_months,
          checkin_frequency_weeks: body.checkin_frequency_weeks,
          last_checkin_at: now,
          next_checkin_due: nextCheckin,
          relance_count: 0,
          last_relance_at: null,
        },
      }),
    ])
  } catch (err) {
    await Promise.allSettled(written.map((k) => store.delete(k)))
    if (err instanceof AppError) throw err
    throw new AppError('VAULT_SYNC_FAILED', { message: 'Échec du dépôt des parts.', cause: err })
  }

  // Lot 2a : le miroir on-chain part après la bascule en base — jamais avant.
  await chain?.enqueue({ userId, configId: cfg.id })

  // DEC-30 / Point-1 : prévenir chaque contact, directement ici. L'adresse ne
  // vit que le temps de l'envoi ; email_log n'en garde que le hash. Le prénom
  // vient de la sealed box (D.2) : le serveur n'en a pas d'autre.
  let notified = 0
  for (const p of prepared) {
    const { email, ownerDisplayName } = p.validated.notification
    const { sent } = await emailService().send({
      userId,
      to: email,
      type: 'contact_designated',
      locale: owner.language,
      params: { link: `${env().FRONTEND_URL}/contact`, ...(ownerDisplayName ? { owner: ownerDisplayName } : {}) },
    })
    if (sent) notified++
  }
  return { activated: true, contacts_notified: notified }
}

function notConfigured(why: string): never {
  throw new AppError('TRANSMISSION_NOT_CONFIGURED', { message: why })
}

// --- Pause, reprise, désactivation (E4-US04, Backend §3.4) ------------------------

async function configOrThrow(userId: string) {
  const cfg = await prisma().transmission_configs.findUnique({ where: { user_id: userId } })
  if (!cfg) notConfigured('Transmission non configurée.')
  return cfg
}

export async function pause(userId: string, body: PauseBody): Promise<TransmissionConfigView> {
  const cfg = await configOrThrow(userId)
  if (cfg.status !== 'active') notConfigured('La transmission doit être active pour être mise en pause.')
  const maxMonths = await configInt('dms.pause_max_months', 3)
  if (body.duration_days > maxMonths * 30) {
    throw new AppError('VALIDATION_ERROR', { details: { duration_days: `${maxMonths} mois maximum` } })
  }
  const now = new Date()
  const pauseUntil = new Date(now.getTime() + body.duration_days * DAY_MS)
  const chain = await prepareChainAction(body.chain, 'pause', ['pause'], await chainContext(userId), { pausedUntil: pauseUntil })
  await prisma().transmission_configs.update({
    where: { id: cfg.id },
    data: { status: 'paused', paused_at: now, pause_until: pauseUntil },
  })
  await chain?.enqueue({ userId, configId: cfg.id })
  return getConfig(userId)
}

/** Fin de pause : le cycle de check-in repart de zéro, comme à l'activation. */
export async function resume(userId: string, chainField?: ChainField): Promise<TransmissionConfigView> {
  const cfg = await configOrThrow(userId)
  if (cfg.status !== 'paused') notConfigured('La transmission n’est pas en pause.')
  const now = new Date()
  // Lot 2a : sans signature, rien n'est écrit — la chaîne expire la pause d'elle-même (D3).
  const chain = await prepareChainAction(chainField, 'resume', ['resume'], await chainContext(userId), { nextDue: new Date(now.getTime() + cfg.checkin_frequency_weeks * WEEK_MS) })
  await prisma().transmission_configs.update({
    where: { id: cfg.id },
    data: {
      status: 'active',
      paused_at: null,
      pause_until: null,
      last_checkin_at: now,
      next_checkin_due: new Date(now.getTime() + cfg.checkin_frequency_weeks * WEEK_MS),
      relance_count: 0,
      last_relance_at: null,
    },
  })
  await chain?.enqueue({ userId, configId: cfg.id })
  return getConfig(userId)
}

/**
 * Désactivation : les parts Shamir sont purgées du stockage et de la base ;
 * les contacts restent (et redeviennent modifiables), la config repasse
 * inactive. Une transmission déclenchée ne se désactive pas.
 */
export async function deactivate(userId: string, chainField?: ChainField): Promise<{ deactivated: true }> {
  const cfg = await configOrThrow(userId)
  if (cfg.status !== 'active' && cfg.status !== 'paused') notConfigured('Aucune transmission active à désactiver.')
  const chain = await prepareChainAction(chainField, 'deactivate', ['deactivate'], await chainContext(userId), {})

  await objectStore().deletePrefix(`shares/${userId}/`)
  await prisma().$transaction([
    prisma().trusted_contacts.updateMany({
      where: { transmission_id: cfg.id },
      data: {
        storj_k1_path: null,
        storj_k2_path: null,
        storj_k3_path: null,
        share_k1_hash: null,
        share_k2_hash: null,
        share_k3_hash: null,
        share_k1_plain_hash: null,
        share_k2_plain_hash: null,
        share_k3_plain_hash: null,
        verify_token: null,
        verify_last_checked_at: null,
      },
    }),
    prisma().transmission_configs.update({
      where: { id: cfg.id },
      data: {
        status: 'inactive',
        activated_at: null,
        paused_at: null,
        pause_until: null,
        last_checkin_at: null,
        next_checkin_due: null,
        relance_count: 0,
        last_relance_at: null,
      },
    }),
  ])
  // contract_registered ne tombe qu'à la confirmation on-chain du deactivate (afterConfirmed).
  await chain?.enqueue({ userId, configId: cfg.id })
  return { deactivated: true }
}

// --- Vérification annuelle (Techniques §7.2) ----------------------------------------

const VERIFY_CHALLENGE_TTL_S = 5 * 60

async function verifiableContact(userId: string, id: string): Promise<{ id: string; verify_token: Uint8Array }> {
  const contact = await prisma().trusted_contacts.findFirst({
    where: { id, user_id: userId, contact_status: { not: 'removed' } },
    select: { id: true, verify_token: true },
  })
  if (!contact) throw new AppError('NOT_FOUND', { message: 'Contact introuvable.' })
  if (!contact.verify_token) notConfigured('Activez la transmission avant la vérification annuelle.')
  return { id: contact.id, verify_token: contact.verify_token }
}

/** Audit LOW-15 : un nonce serveur (5 min, usage unique) entre dans l'attestation — une signature volée ne se rejoue pas. */
export async function verifyChallenge(userId: string, id: string): Promise<{ challenge_id: string; challenge: string; expires_at: string }> {
  const contact = await verifiableContact(userId, id)
  const challengeId = randomToken(24)
  const challenge = randomToken(32)
  await redis().set(redisKeys.verifyChallenge(userId, contact.id, challengeId), challenge, 'EX', VERIFY_CHALLENGE_TTL_S)
  return {
    challenge_id: challengeId,
    challenge: Buffer.from(challenge, 'base64url').toString('base64'),
    expires_at: new Date(Date.now() + VERIFY_CHALLENGE_TTL_S * 1000).toISOString(),
  }
}

/**
 * L'app rejoue les réponses, ouvre verify_token localement, puis atteste
 * le succès en signant SHA256(verify_token ‖ challenge) avec la clé de
 * l'owner. Le serveur ne voit ni réponses ni K_i : il date l'attestation.
 */
export async function verifyContact(userId: string, id: string, challengeId: string, signatureB64: string): Promise<ContactView> {
  const contact = await verifiableContact(userId, id)

  // Consommé à la première tentative, bonne ou mauvaise.
  const challengeB64url = await redis().getdel(redisKeys.verifyChallenge(userId, contact.id, challengeId))
  if (!challengeB64url) throw new AppError('AUTH_TOKEN_INVALID', { message: 'Challenge de vérification invalide ou expiré.' })

  const signature = decodeOrThrow('signature', signatureB64)
  const { ed25519Pk } = await ownerKey(userId)
  const digest = Buffer.from(sha256Hex(Buffer.concat([Buffer.from(contact.verify_token), Buffer.from(challengeB64url, 'base64url')])), 'hex')
  if (!ed25519Verify(ed25519Pk, digest, Buffer.from(signature))) {
    throw new AppError('AUTH_TOKEN_INVALID', { message: 'Attestation de vérification invalide.' })
  }
  const row = await prisma().trusted_contacts.update({
    where: { id },
    data: { verify_last_checked_at: new Date() },
    select: contactSelect,
  })
  return toContactView(row)
}
