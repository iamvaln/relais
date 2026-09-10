// Relay — transmission côté contact (Backend Specs §3.7, Techniques §6.7–6.8, E5).
//
// Ouverture : quand le dead man's switch a déclenché (transmission_configs
// 'triggered'), une ligne `transmissions` fige le schéma N-of-M et l'escrow,
// chaque contact vivant reçoit un token de relay (HMAC en base, 72 h) par
// email — l'adresse sort de la sealed box le temps de l'envoi (DEC-28/30).

import { env } from '../../config/env.js'
import { configInt } from '../../lib/app-config.js'
import { hmacToken, randomToken } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { emailService } from '../../services/email/index.js'
import { objectStore } from '../../services/storage/index.js'
import { openNotification } from '../transmission/service.js'

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
  transmissions: { include: { users: { select: { full_name: true } } } },
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
      prisma().transmission_contacts.update({ where: { id: c.id }, data: { blocked: false, fail_count: 0 } }),
      prisma().trusted_contacts.update({ where: { id: c.trusted_contact_id }, data: { blocked_until: null, fail_count: 0 } }),
    ])
    c.blocked = false
    c.fail_count = 0
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
