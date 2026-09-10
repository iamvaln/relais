// Vérifie l'access token et charge l'utilisateur (Backend Specs §2.3, étape 2).
//
// L'access token porte l'id de session (`sid`). On vérifie que cette session
// existe encore : une révocation — logout, changement ou réinitialisation de
// mot de passe, admin — prend effet immédiatement, pas à l'expiration du
// token 15 minutes plus tard. C'est ce qu'exigent E6-US03 (« toutes les
// sessions actives sur d'autres devices sont invalidées ») et le blocage
// immédiat d'un compte suspendu.
//
// Une seule lecture par clé primaire, avec l'utilisateur joint.

import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '../lib/errors.js'
import { verifyAccessToken } from '../lib/jwt.js'
import { prisma } from '../lib/prisma.js'
import type { AuthenticatedUser } from '../types/fastify.js'

export async function loadAuthenticatedUser(userId: string, sessionId: string): Promise<AuthenticatedUser> {
  const session = await prisma().sessions.findUnique({
    where: { id: sessionId },
    select: {
      user_id: true,
      expires_at: true,
      users: {
        select: { id: true, plan: true, language: true, email_verified: true, totp_enabled: true, account_status: true, deleted_at: true },
      },
    },
  })
  if (!session || session.user_id !== userId) throw new AppError('AUTH_TOKEN_INVALID')
  if (session.expires_at.getTime() < Date.now()) throw new AppError('AUTH_TOKEN_EXPIRED')

  const user = session.users
  if (user.deleted_at) throw new AppError('AUTH_TOKEN_INVALID')
  if (user.account_status === 'suspended') throw new AppError('AUTH_ACCOUNT_SUSPENDED')

  return {
    id: user.id,
    sessionId,
    plan: user.plan === 'premium' ? 'premium' : 'free',
    language: user.language === 'en' ? 'en' : 'fr',
    emailVerified: user.email_verified,
    totpEnabled: user.totp_enabled,
  }
}

export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) throw new AppError('AUTH_TOKEN_INVALID')
  const claims = await verifyAccessToken(header.slice('Bearer '.length).trim())
  req.user = await loadAuthenticatedUser(claims.sub, claims.sid)
}
