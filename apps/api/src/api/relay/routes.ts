// Routes /relay (Backend Specs §3.7) — publiques, authentifiées par le token du lien.

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { limits } from '../../plugins/rate-limit.js'
import { tokenParams, verifyBody, type TokenParams, type VerifyBody } from './schemas.js'
import * as relay from './service.js'

export async function relayRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: TokenParams }>(
    '/:token',
    { schema: { params: tokenParams }, config: { rateLimit: limits.relayRead } },
    async (req) => ok(await relay.readLink(req.params.token)),
  )

  // Les tentatives sont comptées par le handler (5 par token, puis 24 h) : pas de limiteur générique ici.
  app.post<{ Params: TokenParams; Body: VerifyBody }>(
    '/:token/verify',
    { schema: { params: tokenParams, body: verifyBody } },
    async (req) => ok(await relay.verify(req.params.token, req.body)),
  )
}
