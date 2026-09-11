// Routes /journal (Backend Specs §3.6).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import {
  entryBody,
  entryDeleteBody,
  entryParams,
  entryUpdateBody,
  monthParams,
  questionQuery,
  wrappedBody,
  yearParams,
  type EntryBody,
  type EntryDeleteBody,
  type EntryParams,
  type EntryUpdateBody,
  type MonthParams,
  type QuestionQuery,
  type WrappedBody,
  type YearParams,
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

  app.get<{ Params: MonthParams }>(
    '/entries/month/:ym',
    { schema: { params: monthParams }, preHandler: [authenticate] },
    async (req) => ok(await journal.getEntryByMonth(req.user!.id, req.params.ym)),
  )

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

  app.post<{ Params: YearParams; Body: WrappedBody }>(
    '/wrapped/:year',
    { schema: { params: yearParams, body: wrappedBody }, preHandler: [authenticate] },
    async (req, reply) => {
      const { view, created } = await journal.saveWrapped(req.user!.id, journal.parseYear(req.params.year), req.body)
      reply.status(created ? 201 : 200)
      return ok(view)
    },
  )

  app.get<{ Params: YearParams }>(
    '/wrapped/:year',
    { schema: { params: yearParams }, preHandler: [authenticate] },
    async (req) => ok(await journal.getWrapped(req.user!.id, journal.parseYear(req.params.year))),
  )

  app.get<{ Params: YearParams }>(
    '/wrapped/:year/export',
    { schema: { params: yearParams }, preHandler: [authenticate] },
    async (req) => ok(await journal.wrappedExportMeta(req.user!.id, journal.parseYear(req.params.year))),
  )

  app.post<{ Params: YearParams }>(
    '/wrapped/:year/export',
    { schema: { params: yearParams }, preHandler: [authenticate] },
    async (req) => ok(await journal.markWrappedExported(req.user!.id, journal.parseYear(req.params.year))),
  )
}
