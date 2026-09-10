// Routes /relay (Backend Specs §3.7) — publiques, authentifiées par le token du lien.

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { limits } from '../../plugins/rate-limit.js'
import { tokenParams, type TokenParams } from './schemas.js'
import * as relay from './service.js'

export async function relayRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: TokenParams }>(
    '/:token',
    { schema: { params: tokenParams }, config: { rateLimit: limits.relayRead } },
    async (req) => ok(await relay.readLink(req.params.token)),
  )
}
