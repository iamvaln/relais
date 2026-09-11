// Création d'un administrateur — par script uniquement (npm run admin:create),
// la spec §3.8 n'expose aucun endpoint pour ça. Le TOTP est obligatoire à la
// connexion : le secret est généré ici et l'URI otpauth affichée une fois.

import * as OTPAuth from 'otpauth'
import { hashPassword, sha256Hex } from '../../lib/crypto.js'
import { audit } from '../../lib/audit.js'
import { prisma } from '../../lib/prisma.js'
import { normalizeEmail, passwordPolicyErrors } from '../auth/service.js'

export const ADMIN_ROLES = ['super_admin', 'admin', 'support', 'finance'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value)
}

export interface CreateAdminInput {
  email: string
  full_name: string
  password: string
  role: string
  /** Admin à l'origine de la création (NULL depuis le script). */
  createdBy?: string | null
}

export interface CreatedAdmin {
  id: string
  totp_secret: string
  otpauth_uri: string
}

export async function createAdmin(input: CreateAdminInput): Promise<CreatedAdmin> {
  const errors = passwordPolicyErrors(input.password)
  if (errors.length > 0) throw new Error(`Mot de passe trop faible : ${errors.join(', ')}`)
  if (!isAdminRole(input.role)) throw new Error(`Rôle inconnu : ${input.role} (${ADMIN_ROLES.join(', ')})`)
  const email = normalizeEmail(input.email)
  if (await prisma().admin_users.findUnique({ where: { email }, select: { id: true } })) {
    throw new Error(`Un admin existe déjà avec l'email ${email}`)
  }

  const secret = new OTPAuth.Secret({ size: 20 })
  const totp = new OTPAuth.TOTP({ issuer: 'Relais Admin', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret })
  const row = await prisma().admin_users.create({
    data: {
      email,
      full_name: input.full_name,
      password_hash: await hashPassword(input.password),
      role: input.role,
      totp_secret: secret.base32,
      totp_enabled: true,
      created_by: input.createdBy ?? null,
    },
    select: { id: true },
  })
  await audit({
    adminId: input.createdBy ?? null,
    action: 'ADMIN_CREATED',
    targetType: 'admin',
    targetId: row.id,
    after: { role: input.role, email_hash: sha256Hex(email) },
    ip: input.createdBy ? 'admin' : 'cli',
  })
  return { id: row.id, totp_secret: secret.base32, otpauth_uri: totp.toString() }
}
