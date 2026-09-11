// Routes /admin (Backend Specs §3.8) — back office, token admin distinct.

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticateAdmin } from '../../middleware/authenticate-admin.js'
import { limits } from '../../plugins/rate-limit.js'
import { adminLoginBody, type AdminLoginBody } from './schemas.js'
import * as admin from './service.js'

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AdminLoginBody }>(
    '/auth/login',
    { schema: { body: adminLoginBody }, config: { rateLimit: limits.adminLogin } },
    async (req) => {
      const ua = req.headers['user-agent']
      return ok(await admin.login(req.body.email, req.body.password, req.body.code, { ip: req.ip, ...(ua ? { userAgent: ua } : {}) }))
    },
  )

  app.post('/auth/logout', { preHandler: [authenticateAdmin] }, async (req) => {
    await admin.logout(req.admin!.sessionId)
    return ok({ logged_out: true })
  })

  app.get('/me', { preHandler: [authenticateAdmin], config: { rateLimit: limits.admin } }, async (req) => ok(await admin.me(req.admin!.id)))
}
