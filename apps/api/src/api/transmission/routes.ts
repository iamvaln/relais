// Routes /transmission (Backend Specs §3.4).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireStepUp } from '../../middleware/require-step-up.js'
import { limits } from '../../plugins/rate-limit.js'
import { relaisKeyVersion, relaisPublicKeyBase64 } from '../../services/secrets/index.js'
import * as transmission from './service.js'
import {
  activateBody,
  configBody,
  contactBody,
  contactParams,
  schemaBody,
  type ActivateBody,
  type ConfigBody,
  type ContactBody,
  type ContactParams,
  type SchemaBody,
} from './schemas.js'

export async function transmissionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config', { preHandler: [authenticate] }, async (req) => ok(await transmission.getConfig(req.user!.id)))

  // Clé publique vers laquelle l'app scelle { email, phone } (DEC-28) :
  // publique, non authentifiée, cacheable un jour.
  app.get('/relais-key', { config: { rateLimit: limits.relaisKey } }, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400')
    return ok({ relais_x25519_pk: await relaisPublicKeyBase64(), key_version: await relaisKeyVersion() })
  })

  app.post<{ Body: ContactBody }>(
    '/contacts',
    { schema: { body: contactBody }, preHandler: [authenticate] },
    async (req, reply) => {
      reply.status(201)
      return ok(await transmission.createContact(req.user!.id, req.body))
    },
  )

  app.put<{ Params: ContactParams; Body: ContactBody }>(
    '/contacts/:id',
    { schema: { params: contactParams, body: contactBody }, preHandler: [authenticate, requireStepUp('edit_contacts')] },
    async (req) => ok(await transmission.updateContact(req.user!.id, req.params.id, req.body)),
  )

  app.delete<{ Params: ContactParams }>(
    '/contacts/:id',
    { schema: { params: contactParams }, preHandler: [authenticate, requireStepUp('edit_contacts')] },
    async (req) => ok(await transmission.removeContact(req.user!.id, req.params.id)),
  )

  app.put<{ Body: SchemaBody }>(
    '/schema',
    { schema: { body: schemaBody }, preHandler: [authenticate, requireStepUp('edit_contacts')] },
    async (req) => ok(await transmission.updateSchema(req.user!.id, req.body)),
  )

  app.put<{ Body: ConfigBody }>(
    '/config',
    { schema: { body: configBody }, preHandler: [authenticate, requireStepUp('edit_transmission')] },
    async (req) => ok(await transmission.updateConfig(req.user!.id, req.body)),
  )

  app.post<{ Body: ActivateBody }>(
    '/activate',
    { schema: { body: activateBody }, preHandler: [authenticate, requireStepUp('activate_transmission')] },
    async (req) => ok(await transmission.activate(req.user!.id, req.body)),
  )
}
