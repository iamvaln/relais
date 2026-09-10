// Routes /checkin (Backend Specs §3.5).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import * as checkin from './service.js'

export async function checkinRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', { preHandler: [authenticate] }, async (req) => ok(await checkin.getStatus(req.user!.id)))
  app.get('/history', { preHandler: [authenticate] }, async (req) => ok(await checkin.getHistory(req.user!.id)))
}
