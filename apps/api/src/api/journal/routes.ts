// Routes /journal (Backend Specs §3.6).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import {
  entryBody,
  entryDeleteBody,
  entryParams,
  entryUpdateBody,
  questionQuery,
  type EntryBody,
  type EntryDeleteBody,
  type EntryParams,
  type EntryUpdateBody,
  type QuestionQuery,
} from './schemas.js'
import * as journal from './service.js'

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: QuestionQuery }>(
    '/question',
    { schema: { querystring: questionQuery }, preHandler: [authenticate] },
    async (req) => ok(await journal.getQuestion(req.user!.id, req.query.mode)),
  )

  app.post<{ Body: EntryBody }>('/entries', { schema: { body: entryBody }, preHandler: [authenticate] }, async (req, reply) => {
    reply.status(201)
    return ok(await journal.createEntry(req.user!.id, req.body))
  })

  app.get('/entries', { preHandler: [authenticate] }, async (req) => ok(await journal.listEntries(req.user!.id)))

  app.get<{ Params: EntryParams }>(
    '/entries/:id',
    { schema: { params: entryParams }, preHandler: [authenticate] },
    async (req) => ok(await journal.getEntry(req.user!.id, req.params.id)),
  )

  app.put<{ Params: EntryParams; Body: EntryUpdateBody }>(
    '/entries/:id',
    { schema: { params: entryParams, body: entryUpdateBody }, preHandler: [authenticate] },
    async (req) => ok(await journal.updateEntry(req.user!.id, req.params.id, req.body)),
  )

  app.delete<{ Params: EntryParams; Body: EntryDeleteBody }>(
    '/entries/:id',
    { schema: { params: entryParams, body: entryDeleteBody }, preHandler: [authenticate] },
    async (req) => ok(await journal.deleteEntry(req.user!.id, req.params.id, req.body.signature)),
  )
}
