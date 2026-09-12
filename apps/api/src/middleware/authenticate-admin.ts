// Authentification du back office : token admin (audience 'admin') + session
// Redis vivante + compte admin actif. Un token utilisateur est refusé (autre
// audience), un logout révoque immédiatement (la session Redis disparaît).

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import { AppError } from '../lib/errors.js'
import { verifyAdminToken } from '../lib/jwt.js'
import { prisma } from '../lib/prisma.js'
import { keys, redis } from '../lib/redis.js'

export async function authenticateAdmin(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) throw new AppError('AUTH_TOKEN_INVALID')
  const claims = await verifyAdminToken(header.slice('Bearer '.length).trim())

  const owner = await redis().get(keys.adminSession(claims.sid))
  if (owner !== claims.sub) throw new AppError('AUTH_TOKEN_INVALID')

  const admin = await prisma().admin_users.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, full_name: true, role: true, status: true },
  })
  if (!admin) throw new AppError('AUTH_TOKEN_INVALID')
  if (admin.status !== 'active') throw new AppError('AUTH_ACCOUNT_SUSPENDED')

  req.admin = { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role, sessionId: claims.sid }
}

/** Grille BO : le super_admin passe partout ; sinon le rôle doit être listé. */
export function requireRole(...roles: string[]): preHandlerHookHandler {
  return async function roleGuard(req: FastifyRequest): Promise<void> {
    if (!req.admin) throw new AppError('AUTH_TOKEN_INVALID')
    if (req.admin.role === 'super_admin' || roles.includes(req.admin.role)) return
    throw new AppError('AUTH_FORBIDDEN')
  }
}
