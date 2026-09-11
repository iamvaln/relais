// Routes /admin (Backend Specs §3.8) — back office, token admin distinct.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticateAdmin, requireRole } from '../../middleware/authenticate-admin.js'
import { limits } from '../../plugins/rate-limit.js'
import {
  adminLoginBody,
  contactParams,
  emailChangeBody,
  extendEscrowBody,
  idParams,
  otpRegenBody,
  reasonBody,
  transmissionListQuery,
  userListQuery,
  type AdminLoginBody,
  type ContactParams,
  type EmailChangeBody,
  type ExtendEscrowBody,
  type IdParams,
  type OtpRegenBody,
  type ReasonBody,
  type TransmissionListQuery,
  type UserListQuery,
} from './schemas.js'
import * as admin from './service.js'
import * as users from './users.js'
import * as transmissions from './transmissions.js'
import type { RequestContext } from './service.js'

function ctx(req: FastifyRequest): RequestContext {
  const ua = req.headers['user-agent']
  return { ip: req.ip, ...(ua ? { userAgent: ua } : {}) }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AdminLoginBody }>(
    '/auth/login',
    { schema: { body: adminLoginBody }, config: { rateLimit: limits.adminLogin } },
    async (req) => {
      return ok(await admin.login(req.body.email, req.body.password, req.body.code, ctx(req)))
    },
  )

  app.post('/auth/logout', { preHandler: [authenticateAdmin] }, async (req) => {
    await admin.logout(req.admin!.sessionId)
    return ok({ logged_out: true })
  })

  app.get('/me', { preHandler: [authenticateAdmin], config: { rateLimit: limits.admin } }, async (req) => ok(await admin.me(req.admin!.id)))

  // --- BO-02 Utilisateurs ---------------------------------------------------------
  const support = [authenticateAdmin, requireRole('support', 'admin')]
  const adminOnly = [authenticateAdmin, requireRole('admin')]
  const superOnly = [authenticateAdmin, requireRole()]

  app.get<{ Querystring: UserListQuery }>(
    '/users',
    { schema: { querystring: userListQuery }, preHandler: support, config: { rateLimit: limits.admin } },
    async (req) => ok(await users.listUsers(req.query)),
  )
  app.get<{ Params: IdParams }>(
    '/users/:id',
    { schema: { params: idParams }, preHandler: support, config: { rateLimit: limits.admin } },
    async (req) => ok(await users.getUser(req.params.id)),
  )
  app.post<{ Params: IdParams; Body: ReasonBody }>(
    '/users/:id/unblock',
    { schema: { params: idParams, body: reasonBody }, preHandler: support },
    async (req) => ok(await users.unblockUser(req.admin!.id, req.params.id, req.body.reason, ctx(req))),
  )
  app.post<{ Body: OtpRegenBody }>(
    '/users/otp-regen',
    { schema: { body: otpRegenBody }, preHandler: support },
    async (req) => ok(await users.regenerateOtp(req.admin!.id, req.body.email, ctx(req))),
  )
  app.post<{ Params: IdParams; Body: ReasonBody }>(
    '/users/:id/suspend',
    { schema: { params: idParams, body: reasonBody }, preHandler: adminOnly },
    async (req) => ok(await users.suspendUser(req.admin!.id, req.params.id, req.body.reason, ctx(req))),
  )
  app.put<{ Params: IdParams; Body: EmailChangeBody }>(
    '/users/:id/email',
    { schema: { params: idParams, body: emailChangeBody }, preHandler: adminOnly },
    async (req) => ok(await users.changeEmail(req.admin!.id, req.params.id, req.body, ctx(req))),
  )
  app.delete<{ Params: IdParams; Body: ReasonBody }>(
    '/users/:id',
    { schema: { params: idParams, body: reasonBody }, preHandler: superOnly },
    async (req) => ok(await users.deleteUser(req.admin!.id, req.params.id, req.body.reason, ctx(req))),
  )

  // --- BO-03 Transmissions --------------------------------------------------------
  app.get<{ Querystring: TransmissionListQuery }>(
    '/transmissions',
    { schema: { querystring: transmissionListQuery }, preHandler: support, config: { rateLimit: limits.admin } },
    async (req) => ok(await transmissions.listTransmissions(req.query)),
  )
  app.get<{ Params: IdParams }>(
    '/transmissions/:id',
    { schema: { params: idParams }, preHandler: support, config: { rateLimit: limits.admin } },
    async (req) => ok(await transmissions.getTransmission(req.params.id)),
  )
  app.post<{ Params: IdParams; Body: ExtendEscrowBody }>(
    '/transmissions/:id/extend-escrow',
    { schema: { params: idParams, body: extendEscrowBody }, preHandler: adminOnly },
    async (req) => ok(await transmissions.extendEscrow(req.admin!.id, req.params.id, req.body, ctx(req))),
  )
  app.post<{ Params: IdParams; Body: ReasonBody }>(
    '/transmissions/:id/notify',
    { schema: { params: idParams, body: reasonBody }, preHandler: adminOnly },
    async (req) => ok(await transmissions.notifyContacts(req.admin!.id, req.params.id, req.body.reason, ctx(req))),
  )
  app.delete<{ Params: IdParams; Body: ReasonBody }>(
    '/transmissions/:id',
    { schema: { params: idParams, body: reasonBody }, preHandler: superOnly },
    async (req) => ok(await transmissions.cancelTransmission(req.admin!.id, req.params.id, req.body.reason, ctx(req))),
  )
  app.post<{ Params: ContactParams; Body: ReasonBody }>(
    '/transmissions/:id/contacts/:cid/unblock',
    { schema: { params: contactParams, body: reasonBody }, preHandler: support },
    async (req) => ok(await transmissions.unblockContact(req.admin!.id, req.params.id, req.params.cid, req.body.reason, ctx(req))),
  )
}
