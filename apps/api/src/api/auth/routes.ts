// Routes /auth (Backend Specs §3.1 v1.1, DEC-25, DEC-27).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AppError, ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireStepUp } from '../../middleware/require-step-up.js'
import { limits } from '../../plugins/rate-limit.js'
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, refreshCookieOptions } from '../../plugins/security.js'
import * as auth from './service.js'
import {
  changePasswordBody,
  emailOnlyBody,
  emailVerifyBody,
  keysBody,
  loginBody,
  passwordResetBody,
  registerBody,
  restoreVerifyBody,
  stepUpBody,
  twoFactorDisableBody,
  twoFactorVerifyBody,
  type ChangePasswordBody,
  type EmailOnlyBody,
  type EmailVerifyBody,
  type KeysBody,
  type LoginBody,
  type PasswordResetBody,
  type RegisterBody,
  type RestoreVerifyBody,
  type StepUpBody,
  type TwoFactorDisableBody,
  type TwoFactorVerifyBody,
} from './schemas.js'

function ctx(req: FastifyRequest): auth.SessionContext {
  return { userAgent: req.headers['user-agent'], ip: req.ip }
}

function sendSession(reply: FastifyReply, session: auth.IssuedSession, user: auth.PublicUser) {
  reply.setCookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(session.refreshMaxAge))
  return ok({ access_token: session.accessToken, token_type: 'Bearer', expires_in: session.expiresIn, user })
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH })
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // --- Inscription -------------------------------------------------------------

  app.post<{ Body: RegisterBody }>(
    '/register',
    { schema: { body: registerBody }, config: { rateLimit: limits.register } },
    async (req) => {
      await auth.register(req.body)
      // Toujours la même réponse, que l'adresse soit libre ou non (E1-US01).
      return ok({ pending: true })
    },
  )

  app.post<{ Body: EmailVerifyBody }>(
    '/email/verify',
    { schema: { body: emailVerifyBody }, config: { rateLimit: limits.emailVerify } },
    async (req, reply) => {
      const { session, user } = await auth.verifyRegistration(req.body.email, req.body.code, ctx(req))
      return sendSession(reply, session, user)
    },
  )

  app.post<{ Body: EmailOnlyBody }>(
    '/email/resend-otp',
    { schema: { body: emailOnlyBody }, config: { rateLimit: limits.resendOtp } },
    async (req) => {
      await auth.resendRegistrationOtp(req.body.email)
      return ok({ pending: true })
    },
  )

  // --- Session -----------------------------------------------------------------

  app.post<{ Body: LoginBody }>(
    '/login',
    { schema: { body: loginBody }, config: { rateLimit: limits.login } },
    async (req, reply) => {
      const result = await auth.login(req.body.email, req.body.password, ctx(req))
      if (result.kind === '2fa') {
        return ok({ requires_2fa: true, temp_token: result.tempToken, expires_in: result.expiresIn })
      }
      return sendSession(reply, result.session, result.user)
    },
  )

  app.post('/refresh', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE]
    if (!token) {
      clearRefreshCookie(reply)
      return reply.status(401).send({ success: false, error: { code: 'AUTH_TOKEN_INVALID', message: 'Aucune session.' } })
    }
    try {
      const session = await auth.refreshSession(token)
      reply.setCookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(session.refreshMaxAge))
      return ok({ access_token: session.accessToken, token_type: 'Bearer', expires_in: session.expiresIn })
    } catch (err) {
      clearRefreshCookie(reply)
      throw err
    }
  })

  app.post('/logout', { preHandler: [authenticate] }, async (req, reply) => {
    await auth.revokeSession(req.user!.sessionId, req.user!.id)
    clearRefreshCookie(reply)
    return ok({ logged_out: true })
  })

  app.get('/me', { preHandler: [authenticate] }, async (req) => ok(await auth.currentUser(req.user!.id)))

  // --- Step-up (DEC-25) --------------------------------------------------------

  app.post<{ Body: StepUpBody }>(
    '/pin/step-up',
    { schema: { body: stepUpBody }, preHandler: [authenticate], config: { rateLimit: limits.stepUp } },
    async (req) => ok(await auth.issueStepUp(req.user!.id, req.body.action)),
  )

  // DEC-27 : POST, pas GET. Le serveur n'a jamais le seed ; il autorise
  // seulement l'app à déchiffrer seed_enc_pin localement.
  app.post('/seed/display', { preHandler: [authenticate, requireStepUp('view_seed')] }, async () =>
    ok({ authorized: true }),
  )

  // --- Clé publique (DEC-05) ---------------------------------------------------

  app.post<{ Body: KeysBody }>('/keys', { schema: { body: keysBody }, preHandler: [authenticate] }, async (req) => {
    await auth.registerPublicKey(req.user!.id, req.body.ed25519_pk)
    return ok({ registered: true })
  })

  // --- Mot de passe ------------------------------------------------------------

  app.put<{ Body: ChangePasswordBody }>(
    '/password',
    { schema: { body: changePasswordBody }, preHandler: [authenticate, requireStepUp('change_password')] },
    async (req) => {
      const r = await auth.changePassword(req.user!.id, req.user!.sessionId, req.body.current_password, req.body.new_password)
      return ok({ changed: true, ...r })
    },
  )

  app.post<{ Body: EmailOnlyBody }>(
    '/password/reset-request',
    { schema: { body: emailOnlyBody }, config: { rateLimit: limits.resendOtp } },
    async (req) => {
      await auth.requestPasswordReset(req.body.email)
      return ok({ pending: true })
    },
  )

  app.post<{ Body: PasswordResetBody }>(
    '/password/reset',
    { schema: { body: passwordResetBody }, config: { rateLimit: limits.restore } },
    async (req) => {
      await auth.resetPassword(req.body)
      return ok({ reset: true })
    },
  )

  // --- Restauration (DEC-06) ---------------------------------------------------

  app.get('/restore/challenge', { preHandler: [authenticate], config: { rateLimit: limits.restore } }, async (req) =>
    ok(await auth.createRestoreChallenge(req.user!.id)),
  )

  app.post<{ Body: RestoreVerifyBody }>(
    '/restore/verify',
    { schema: { body: restoreVerifyBody }, preHandler: [authenticate], config: { rateLimit: limits.restore } },
    async (req) => {
      await auth.verifyRestoreChallenge(req.user!.id, req.body.challenge_id, req.body.signature)
      return ok({ verified: true })
    },
  )

  // --- 2FA TOTP (E6-US02) ------------------------------------------------------

  app.post('/2fa/setup', { preHandler: [authenticate] }, async (req) => ok(await auth.setupTwoFactor(req.user!.id)))

  // Deux usages, un endpoint (§3.1) : avec temp_token c'est la fin du login,
  // sans c'est l'activation et l'access token est requis.
  app.post<{ Body: TwoFactorVerifyBody }>(
    '/2fa/verify',
    { schema: { body: twoFactorVerifyBody }, config: { rateLimit: limits.twoFactorVerify } },
    async (req, reply) => {
      const { code, recovery_code, temp_token } = req.body
      if (temp_token) {
        // Fin du login : un code TOTP ou un code de récupération, pas les deux (Point-2)
        if ((code === undefined) === (recovery_code === undefined)) {
          throw new AppError('VALIDATION_ERROR', { details: { body: 'soit code, soit recovery_code' } })
        }
        const proof = code !== undefined ? { code } : { recovery_code: recovery_code! }
        const { session, user } = await auth.completeTwoFactorLogin(temp_token, proof, ctx(req))
        return sendSession(reply, session, user)
      }
      if (code === undefined) throw new AppError('VALIDATION_ERROR', { details: { code: 'requis pour activer la 2FA' } })
      await authenticate(req, reply)
      const { recovery_codes } = await auth.activateTwoFactor(req.user!.id, code)
      return ok({ enabled: true, recovery_codes })
    },
  )

  app.delete<{ Body: TwoFactorDisableBody }>(
    '/2fa',
    { schema: { body: twoFactorDisableBody }, preHandler: [authenticate, requireStepUp('disable_2fa')] },
    async (req) => {
      await auth.disableTwoFactor(req.user!.id, req.body.code)
      return ok({ disabled: true })
    },
  )
}
