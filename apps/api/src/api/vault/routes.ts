// Routes /vault (Backend Specs §3.3 v1.1). Trois endpoints — DEC-21 a retiré
// tout ce qui aurait donné au serveur une vue sur le contenu.

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import { limits } from '../../plugins/rate-limit.js'
import * as vault from './service.js'
import { restoreBody, syncBody, type RestoreBody, type SyncBody } from './schemas.js'

// vault.max_size_mb = 50 par blob ; en base64 dans une enveloppe JSON, on
// laisse de la marge. La limite exacte est appliquée sur les octets décodés.
const SYNC_BODY_LIMIT = 96 * 1024 * 1024

export async function vaultRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SyncBody }>(
    '/sync',
    { schema: { body: syncBody }, preHandler: [authenticate], bodyLimit: SYNC_BODY_LIMIT, config: { rateLimit: limits.vaultSync } },
    async (req) => ok(await vault.sync(req.user!.id, req.body)),
  )

  app.get('/sync-status', { preHandler: [authenticate], config: { rateLimit: limits.vault } }, async (req) =>
    ok(await vault.syncStatus(req.user!.id)),
  )

  app.post<{ Body: RestoreBody }>(
    '/restore',
    { schema: { body: restoreBody }, preHandler: [authenticate], config: { rateLimit: limits.vault } },
    async (req) => ok(await vault.restore(req.user!.id, req.body.category)),
  )
}
