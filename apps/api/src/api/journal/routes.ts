// Routes /journal (Backend Specs §3.6).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import { questionQuery, type QuestionQuery } from './schemas.js'
import * as journal from './service.js'

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: QuestionQuery }>(
    '/question',
    { schema: { querystring: questionQuery }, preHandler: [authenticate] },
    async (req) => ok(await journal.getQuestion(req.user!.id, req.query.mode)),
  )
}
