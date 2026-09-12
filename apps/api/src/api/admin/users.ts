// BO-02 — Utilisateurs : liste, fiche, actions de support. Métadonnées
// seulement : jamais un blob, jamais une donnée de contact.

import { configInt } from '../../lib/app-config.js'
import { audit } from '../../lib/audit.js'
import { sha256Hex } from '../../lib/crypto.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { keys, redis } from '../../lib/redis.js'
import { emailService } from '../../services/email/index.js'
import { objectStore } from '../../services/storage/index.js'
import { normalizeEmail, resendRegistrationOtp } from '../auth/service.js'
import { vaultPrefix } from '../vault/service.js'
import type { EmailChangeBody, UserListQuery } from './schemas.js'
import type { RequestContext } from './service.js'

const DAY_MS = 24 * 3600 * 1000

// --- Vues ------------------------------------------------------------------------

export interface UserRowView {
  id: string
  full_name: string
  email: string
  phone: string | null
  language: string
  plan: string
  account_status: string
  email_verified: boolean
  transmission_status: string
  last_checkin_at: string | null
  created_at: string
}

export interface UserDetailView extends UserRowView {
  totp_enabled: boolean
  login_fail_count: number
  login_locked_until: string | null
  deleted_at: string | null
  subscription: { plan: string; status: string; expires_at: string | null } | null
  transmission: {
    status: string
    schema: { n: number; m: number }
    contacts_count: number
    next_checkin_due: string | null
    activated_at: string | null
    pause_until: string | null
  } | null
  counts: { journal_entries: number; checkins: number; sessions: number }
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

const rowSelect = {
  id: true,
  full_name: true,
  email: true,
  phone: true,
  language: true,
  plan: true,
  account_status: true,
  email_verified: true,
  created_at: true,
  transmission_configs: { select: { status: true, last_checkin_at: true } },
} as const

type Row = {
  id: string
  full_name: string
  email: string
  phone: string | null
  language: string
  plan: string
  account_status: string
  email_verified: boolean
  created_at: Date
  transmission_configs: { status: string; last_checkin_at: Date | null } | null
}

function toRow(u: Row): UserRowView {
  return {
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    phone: u.phone,
    language: u.language,
    plan: u.plan,
    account_status: u.account_status,
    email_verified: u.email_verified,
    transmission_status: u.transmission_configs?.status ?? 'inactive',
    last_checkin_at: u.transmission_configs?.last_checkin_at?.toISOString() ?? null,
    created_at: u.created_at.toISOString(),
  }
}

// --- Liste et fiche -----------------------------------------------------------------

export async function listUsers(q: UserListQuery): Promise<Page<UserRowView>> {
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10))
  const limit = Math.min(100, Math.max(1, Number.parseInt(q.limit ?? '20', 10)))
  const where = {
    ...(q.plan ? { plan: q.plan } : {}),
    ...(q.status ? { account_status: q.status } : {}),
    ...(q.transmission
      ? q.transmission === 'inactive'
        ? { OR: [{ transmission_configs: null }, { transmission_configs: { status: 'inactive' } }] }
        : { transmission_configs: { status: q.transmission } }
      : {}),
    ...(q.created_from || q.created_to
      ? {
          created_at: {
            ...(q.created_from ? { gte: new Date(`${q.created_from}T00:00:00Z`) } : {}),
            ...(q.created_to ? { lt: new Date(new Date(`${q.created_to}T00:00:00Z`).getTime() + DAY_MS) } : {}),
          },
        }
      : {}),
    ...(q.search
      ? {
          AND: [
            {
              OR: [
                { email: { contains: q.search, mode: 'insensitive' as const } },
                { full_name: { contains: q.search, mode: 'insensitive' as const } },
                { phone: { contains: q.search } },
              ],
            },
          ],
        }
      : {}),
  }
  const [total, rows] = await Promise.all([
    prisma().users.count({ where }),
    prisma().users.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit, select: rowSelect }),
  ])
  return { items: rows.map(toRow), total, page, limit }
}

async function userOrThrow(id: string) {
  const u = await prisma().users.findUnique({ where: { id }, select: { ...rowSelect, totp_enabled: true, login_fail_count: true, login_locked_until: true, deleted_at: true } })
  if (!u) throw new AppError('NOT_FOUND', { message: 'Utilisateur introuvable.' })
  return u
}

export async function getUser(id: string): Promise<UserDetailView> {
  const u = await userOrThrow(id)
  const [sub, cfg, journal, checkins, sessions] = await Promise.all([
    prisma().subscriptions.findUnique({ where: { user_id: id }, select: { plan: true, status: true, expires_at: true } }),
    prisma().transmission_configs.findUnique({
      where: { user_id: id },
      select: {
        status: true,
        schema_n: true,
        schema_m: true,
        next_checkin_due: true,
        activated_at: true,
        pause_until: true,
        _count: { select: { trusted_contacts: { where: { contact_status: { not: 'removed' } } } } },
      },
    }),
    prisma().journal_entries.count({ where: { user_id: id } }),
    prisma().checkin_log.count({ where: { user_id: id } }),
    prisma().sessions.count({ where: { user_id: id } }),
  ])
  return {
    ...toRow(u),
    totp_enabled: u.totp_enabled,
    login_fail_count: u.login_fail_count,
    login_locked_until: u.login_locked_until?.toISOString() ?? null,
    deleted_at: u.deleted_at?.toISOString() ?? null,
    subscription: sub ? { plan: sub.plan, status: sub.status, expires_at: sub.expires_at?.toISOString() ?? null } : null,
    transmission: cfg
      ? {
          status: cfg.status,
          schema: { n: cfg.schema_n, m: cfg.schema_m },
          contacts_count: cfg._count.trusted_contacts,
          next_checkin_due: cfg.next_checkin_due?.toISOString() ?? null,
          activated_at: cfg.activated_at?.toISOString() ?? null,
          pause_until: cfg.pause_until?.toISOString() ?? null,
        }
      : null,
    counts: { journal_entries: journal, checkins, sessions },
  }
}

// --- Actions de support -----------------------------------------------------------

async function notify(userId: string, email: string, language: string, type: 'account_unblocked' | 'account_suspended'): Promise<void> {
  await emailService().send({ userId, to: email, type, locale: language === 'en' ? 'en' : 'fr' })
}

/** Réinitialise les compteurs, lève une suspension ; l'utilisateur est prévenu (BO-02 cas 1). */
export async function unblockUser(adminId: string, id: string, reason: string, ctx: RequestContext): Promise<UserDetailView> {
  const u = await userOrThrow(id)
  if (u.account_status === 'deleted') throw new AppError('NOT_FOUND', { message: 'Compte supprimé.' })
  await prisma().users.update({
    where: { id },
    data: {
      login_fail_count: 0,
      login_locked_until: null,
      otp_fail_count: 0,
      otp_locked_until: null,
      ...(u.account_status === 'suspended' ? { account_status: 'active' } : {}),
    },
  })
  await redis().del(keys.loginFailures(id), keys.loginLock(id))
  await notify(id, u.email, u.language, 'account_unblocked')
  await audit({
    adminId,
    action: 'ACCOUNT_UNBLOCK',
    targetType: 'user',
    targetId: id,
    userId: id,
    before: { account_status: u.account_status, login_fail_count: u.login_fail_count },
    after: { account_status: 'active', login_fail_count: 0 },
    reason,
    ip: ctx.ip,
  })
  return getUser(id)
}

/** BO-02 cas 2 : l'inscription attend dans Redis ; il n'y a pas encore de ligne users. */
export async function regenerateOtp(adminId: string, rawEmail: string, ctx: RequestContext): Promise<{ sent: true }> {
  const email = normalizeEmail(rawEmail)
  const pending = await redis().exists(keys.pendingRegistration(email))
  if (!pending) throw new AppError('NOT_FOUND', { message: 'Aucune inscription en attente pour cet email.' })
  await resendRegistrationOtp(email)
  await audit({ adminId, action: 'OTP_REGEN', targetType: 'user', targetId: sha256Hex(email), ip: ctx.ip })
  return { sent: true }
}

/** Suspension : accès coupé immédiatement (authenticate), transmission en pause, email obligatoire. */
export async function suspendUser(adminId: string, id: string, reason: string, ctx: RequestContext): Promise<UserDetailView> {
  const u = await userOrThrow(id)
  if (u.account_status === 'deleted') throw new AppError('NOT_FOUND', { message: 'Compte supprimé.' })
  const pauseMonths = await configInt('dms.pause_max_months', 3)
  const now = new Date()
  await prisma().$transaction([
    prisma().users.update({ where: { id }, data: { account_status: 'suspended' } }),
    prisma().transmission_configs.updateMany({
      where: { user_id: id, status: 'active' },
      data: { status: 'paused', paused_at: now, pause_until: new Date(now.getTime() + pauseMonths * 30 * DAY_MS) },
    }),
  ])
  await notify(id, u.email, u.language, 'account_suspended')
  await audit({
    adminId,
    action: 'ACCOUNT_SUSPEND',
    targetType: 'user',
    targetId: id,
    userId: id,
    before: { account_status: u.account_status },
    after: { account_status: 'suspended' },
    reason,
    ip: ctx.ip,
  })
  return getUser(id)
}

/** Changement d'email après vérification manuelle ; l'audit ne garde que des hashes. */
export async function changeEmail(adminId: string, id: string, body: EmailChangeBody, ctx: RequestContext): Promise<UserDetailView> {
  const u = await userOrThrow(id)
  if (u.account_status === 'deleted') throw new AppError('NOT_FOUND', { message: 'Compte supprimé.' })
  const email = normalizeEmail(body.email)
  const taken = await prisma().users.findUnique({ where: { email }, select: { id: true } })
  if (taken && taken.id !== id) throw new AppError('USER_EMAIL_TAKEN')
  await prisma().users.update({ where: { id }, data: { email, email_verified: true } })
  await audit({
    adminId,
    action: 'EMAIL_CHANGE',
    targetType: 'user',
    targetId: id,
    userId: id,
    before: { email_hash: sha256Hex(u.email) },
    after: { email_hash: sha256Hex(email) },
    reason: body.reason,
    ip: ctx.ip,
  })
  return getUser(id)
}

/**
 * Suppression RGPD (BO-02 cas 4) : tout ce qui est personnel ou chiffré
 * disparaît — stockage, contacts, carnet, check-ins, sessions — ; les
 * transmissions en cours sont annulées ; la ligne users reste, anonymisée,
 * pour les clés étrangères et le log minimal (id, date, motif).
 */
export async function deleteUser(adminId: string, id: string, reason: string, ctx: RequestContext): Promise<{ deleted: true }> {
  const u = await userOrThrow(id)
  if (u.account_status === 'deleted') throw new AppError('TRANSMISSION_ALREADY_ACTIVE', { message: 'Compte déjà supprimé.' })
  const now = new Date()
  const store = objectStore()
  await store.deletePrefix(vaultPrefix(id))
  await store.deletePrefix(`shares/${id}/`)

  const openTransmissions = await prisma().transmissions.findMany({ where: { user_id: id }, select: { id: true } })
  const trIds = openTransmissions.map((t) => t.id)
  for (const trId of trIds) await redis().del(`escrow:key:${trId}`)

  await prisma().$transaction([
    prisma().escrow_shares.deleteMany({ where: { transmission_id: { in: trIds } } }),
    prisma().transmission_contacts.deleteMany({ where: { transmission_id: { in: trIds } } }),
    prisma().transmissions.updateMany({
      where: { user_id: id, status: { in: ['triggered', 'in_progress'] } },
      data: { status: 'cancelled', cancelled_at: now, cancelled_by_admin: adminId, cancellation_reason: reason },
    }),
    prisma().checkin_log.deleteMany({ where: { user_id: id } }),
    prisma().checkin_relances.deleteMany({ where: { user_id: id } }),
    prisma().trusted_contacts.deleteMany({ where: { user_id: id } }),
    prisma().transmission_configs.updateMany({
      where: { user_id: id },
      data: {
        status: 'inactive',
        activated_at: null,
        paused_at: null,
        pause_until: null,
        last_checkin_at: null,
        next_checkin_due: null,
        relance_count: 0,
        last_relance_at: null,
        contract_registered: false,
      },
    }),
    prisma().journal_entries.deleteMany({ where: { user_id: id } }),
    prisma().annual_wrappeds.deleteMany({ where: { user_id: id } }),
    prisma().sessions.deleteMany({ where: { user_id: id } }),
    prisma().restore_challenges.deleteMany({ where: { user_id: id } }),
    // Audit MEDIUM-9 : l'OTP d'inscription porte l'email en clair avec user_id NULL — par adresse aussi.
    prisma().email_otp.deleteMany({ where: { OR: [{ user_id: id }, { email: u.email }] } }),
    prisma().push_tokens.deleteMany({ where: { user_id: id } }),
    prisma().two_factor_recovery_codes.deleteMany({ where: { user_id: id } }),
    prisma().support_tickets.updateMany({ where: { user_id: id }, data: { user_email: 'deleted' } }),
    prisma().users.update({
      where: { id },
      data: {
        email: `deleted-${id}@anonymized.invalid`,
        full_name: 'Compte supprimé',
        phone: null,
        password_hash: '!deleted',
        ed25519_pk: null,
        totp_secret: null,
        totp_enabled: false,
        account_status: 'deleted',
        deleted_at: now,
        deleted_by: 'admin',
        deleted_by_admin: adminId,
        deletion_reason: reason,
      },
    }),
  ])
  await audit({ adminId, action: 'ACCOUNT_DELETE', targetType: 'user', targetId: id, userId: id, reason, ip: ctx.ip })
  return { deleted: true }
}
