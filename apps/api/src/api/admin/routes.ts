// Routes /admin (Backend Specs §3.8) — back office, token admin distinct.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticateAdmin, requireRole } from '../../middleware/authenticate-admin.js'
import { limits } from '../../plugins/rate-limit.js'
import {
  adminLoginBody,
  auditListQuery,
  configKeyParams,
  configUpdateBody,
  contactParams,
  emailChangeBody,
  exportQuery,
  extendBody,
  extendEscrowBody,
  idParams,
  otpRegenBody,
  planChangeBody,
  questionCreateBody,
  questionListQuery,
  questionUpdateBody,
  reasonBody,
  subscriptionListQuery,
  transmissionListQuery,
  userListQuery,
  type AdminLoginBody,
  type AuditListQuery,
  type ConfigKeyParams,
  type ConfigUpdateBody,
  type ContactParams,
  type EmailChangeBody,
  type ExportQuery,
  type ExtendBody,
  type ExtendEscrowBody,
  type IdParams,
  type OtpRegenBody,
  type PlanChangeBody,
  type QuestionCreateBody,
  type QuestionListQuery,
  type QuestionUpdateBody,
  type ReasonBody,
  type SubscriptionListQuery,
  type TransmissionListQuery,
  type UserListQuery,
} from './schemas.js'
import * as admin from './service.js'
import * as users from './users.js'
import * as transmissions from './transmissions.js'
import * as catalog from './catalog.js'
import * as monitoring from './monitoring.js'
import * as billing from './billing.js'
import * as dashboard from './dashboard.js'
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

  // --- BO-04 Questions -------------------------------------------------------------
  app.get<{ Querystring: QuestionListQuery }>(
    '/questions',
    { schema: { querystring: questionListQuery }, preHandler: adminOnly, config: { rateLimit: limits.admin } },
    async (req) => ok(await catalog.listQuestions(req.query)),
  )
  app.post<{ Body: QuestionCreateBody }>(
    '/questions',
    { schema: { body: questionCreateBody }, preHandler: adminOnly },
    async (req, reply) => {
      reply.status(201)
      return ok(await catalog.createQuestion(req.admin!.id, req.body, ctx(req)))
    },
  )
  app.put<{ Params: IdParams; Body: QuestionUpdateBody }>(
    '/questions/:id',
    { schema: { params: idParams, body: questionUpdateBody }, preHandler: adminOnly },
    async (req) => ok(await catalog.updateQuestion(req.admin!.id, req.params.id, req.body, ctx(req))),
  )
  app.put<{ Params: IdParams; Body: ReasonBody }>(
    '/questions/:id/archive',
    { schema: { params: idParams, body: reasonBody }, preHandler: adminOnly },
    async (req) => ok(await catalog.archiveQuestion(req.admin!.id, req.params.id, req.body.reason, ctx(req))),
  )

  // --- BO-05 Configuration ---------------------------------------------------------
  app.get('/config', { preHandler: superOnly, config: { rateLimit: limits.admin } }, async () => ok(await catalog.listConfig()))
  app.put<{ Params: ConfigKeyParams; Body: ConfigUpdateBody }>(
    '/config/:key',
    { schema: { params: configKeyParams, body: configUpdateBody }, preHandler: superOnly },
    async (req) => ok(await catalog.updateConfig(req.admin!.id, req.params.key, req.body, ctx(req))),
  )

  // --- BO-06 Monitoring ------------------------------------------------------------
  app.get<{ Querystring: AuditListQuery }>(
    '/logs/audit',
    { schema: { querystring: auditListQuery }, preHandler: adminOnly, config: { rateLimit: limits.admin } },
    async (req) => ok(await monitoring.listAudit(req.query)),
  )
  app.get('/health', { preHandler: adminOnly, config: { rateLimit: limits.admin } }, async () => ok(await monitoring.adminHealth()))

  // --- BO-07 Facturation -----------------------------------------------------------
  const financeOnly = [authenticateAdmin, requireRole('finance')]
  app.get<{ Querystring: SubscriptionListQuery }>(
    '/billing/subscriptions',
    { schema: { querystring: subscriptionListQuery }, preHandler: financeOnly, config: { rateLimit: limits.admin } },
    async (req) => ok(await billing.listSubscriptions(req.query)),
  )
  app.put<{ Params: IdParams; Body: PlanChangeBody }>(
    '/billing/:id/plan',
    { schema: { params: idParams, body: planChangeBody }, preHandler: financeOnly },
    async (req) => ok(await billing.changePlan(req.admin!.id, req.params.id, req.body, ctx(req))),
  )
  app.post<{ Params: IdParams; Body: ExtendBody }>(
    '/billing/:id/extend',
    { schema: { params: idParams, body: extendBody }, preHandler: financeOnly },
    async (req) => ok(await billing.extendSubscription(req.admin!.id, req.params.id, req.body, ctx(req))),
  )
  app.get('/billing/overview', { preHandler: financeOnly, config: { rateLimit: limits.admin } }, async () => ok(await billing.overview()))
  app.get<{ Querystring: ExportQuery }>(
    '/billing/export',
    { schema: { querystring: exportQuery }, preHandler: financeOnly, config: { rateLimit: limits.admin } },
    async (req, reply) => {
      const { filename, csv } = await billing.exportCsv(req.query)
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${filename}"`)
      return csv
    },
  )

  // --- BO-01 Dashboard -------------------------------------------------------------
  app.get('/dashboard', { preHandler: adminOnly, config: { rateLimit: limits.admin } }, async () => ok(await dashboard.dashboard()))
}
