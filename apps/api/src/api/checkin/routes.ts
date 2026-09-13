// Routes /checkin (Backend Specs §3.5).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import { limits } from '../../plugins/rate-limit.js'
import { answerBody, completeBody, type AnswerBody, type CompleteBody } from './schemas.js'
import * as checkin from './service.js'

export async function checkinRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', { preHandler: [authenticate] }, async (req) => ok(await checkin.getStatus(req.user!.id)))
  app.get('/history', { preHandler: [authenticate] }, async (req) => ok(await checkin.getHistory(req.user!.id)))

  app.get('/game', { preHandler: [authenticate] }, async (req) => ok(await checkin.getGame(req.user!.id, req.user!.language)))

  app.post<{ Body: AnswerBody }>(
    '/game/answer',
    { schema: { body: answerBody }, preHandler: [authenticate], config: { rateLimit: limits.checkinAnswer } },
    async (req) => ok(await checkin.answerGame(req.user!.id, req.user!.language, req.body.answer)),
  )

  app.post<{ Body: CompleteBody }>(
    '/complete',
    { schema: { body: completeBody }, preHandler: [authenticate] },
    async (req) => ok(await checkin.complete(req.user!.id, req.body.checkin_token, req.body.journal_entry_id, new Date(), req.body.chain)),
  )

  app.get('/streak', { preHandler: [authenticate] }, async (req) => ok(await checkin.getStreak(req.user!.id)))
}
