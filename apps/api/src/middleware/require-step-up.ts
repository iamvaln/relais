// Exige un step-up token pour UNE action donnée (Backend Specs §2.5, DEC-25).
//
// Le PIN ne transite jamais : le client l'a vérifié localement, puis a obtenu
// ce token via POST /auth/pin/step-up. Ici on vérifie :
//   - signature et expiration (JWT_STEPUP_SECRET, 5 min)
//   - que le token appartient bien à l'utilisateur authentifié
//   - que l'action déclarée est celle de l'endpoint appelé
//   - que le jti n'a jamais servi — consommé atomiquement dans Redis (SET NX)
//
// Un token refusé ne consomme rien : un attaquant qui rejoue un token sur le
// mauvais endpoint ne prive pas l'utilisateur légitime de son usage.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import { AppError } from '../lib/errors.js'
import { verifyStepUpToken, type StepUpAction } from '../lib/jwt.js'
import { keys, redis } from '../lib/redis.js'

export const STEP_UP_HEADER = 'x-step-up-token'

export function requireStepUp(action: StepUpAction): preHandlerHookHandler {
  return async function stepUpGuard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!req.user) throw new AppError('AUTH_TOKEN_INVALID')

    const raw = req.headers[STEP_UP_HEADER]
    const token = Array.isArray(raw) ? raw[0] : raw
    if (!token) throw new AppError('AUTH_STEPUP_REQUIRED')

    const claims = await verifyStepUpToken(token)
    if (claims.sub !== req.user.id || claims.action !== action) throw new AppError('AUTH_STEPUP_INVALID')

    // Usage unique : la clé vit jusqu'à l'expiration du token, pas plus.
    const ttl = Math.max(1, claims.exp - Math.floor(Date.now() / 1000))
    const set = await redis().set(keys.stepUpUsed(claims.jti), '1', 'EX', ttl, 'NX')
    if (set !== 'OK') throw new AppError('AUTH_STEPUP_INVALID')

    req.stepUp = { action, jti: claims.jti }
  }
}
