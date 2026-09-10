// Transmission — configuration du dead man's switch et des trusted contacts
// (Backend Specs §3.4, Specs Techniques §4.3, DEC-12, DEC-20, DEC-23).

import { decodeBase64, sha256Hex } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import type { ContactBody, Roles } from './schemas.js'

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

// --- Contacts ----------------------------------------------------------------------

function decodeOrThrow(field: string, value: string): Uint8Array {
  const bytes = decodeBase64(value)
  if (!bytes || bytes.length === 0) throw new AppError('VALIDATION_ERROR', { details: { [field]: 'base64 invalide ou vide' } })
  return new Uint8Array(bytes)
}

export async function createContact(userId: string, body: ContactBody): Promise<ContactView> {
  const notificationEnc = decodeOrThrow('notification_enc', body.notification_enc)
  const notificationSig = decodeOrThrow('notification_sig', body.notification_sig)
  const secretEnc = decodeOrThrow('secret_enc', body.secret_enc)

  const cfg = await ensureConfig(userId)
  const last = await prisma().trusted_contacts.aggregate({ where: { transmission_id: cfg.id }, _max: { contact_order: true } })
  const position = (last._max.contact_order ?? 0) + 1

  const row = await prisma().trusted_contacts.create({
    data: {
      transmission_id: cfg.id,
      user_id: userId,
      contact_order: position,
      notification_enc: notificationEnc,
      notification_sig: notificationSig,
      notification_hash: sha256Hex(Buffer.concat([Buffer.from(notificationEnc), Buffer.from(notificationSig)])),
      secret_enc: secretEnc,
      has_k1_role: body.roles.k1,
      has_k2_role: body.roles.k2,
      has_k3_role: body.roles.k3,
      question_1_id: body.question_ids[0],
      question_2_id: body.question_ids[1],
      question_3_id: body.question_ids[2],
    },
    select: contactSelect,
  })
  return toContactView(row)
}
