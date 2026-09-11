// Routes /support — tickets (BO-02).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate, authenticateIfPresent } from '../../middleware/authenticate.js'
import { limits } from '../../plugins/rate-limit.js'
import { ticketCreateBody, type TicketCreateBody } from './schemas.js'
import * as support from './service.js'

export async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: TicketCreateBody }>(
    '/tickets',
    { schema: { body: ticketCreateBody }, preHandler: [authenticateIfPresent], config: { rateLimit: limits.supportTicket } },
    async (req, reply) => {
      reply.status(201)
      return ok(await support.createTicket(req.user?.id ?? null, req.body))
    },
  )

  app.get('/tickets', { preHandler: [authenticate] }, async (req) => ok(await support.listMyTickets(req.user!.id)))
}
