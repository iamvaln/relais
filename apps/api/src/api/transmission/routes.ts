// Routes /transmission (Backend Specs §3.4).

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireStepUp } from '../../middleware/require-step-up.js'
import { limits } from '../../plugins/rate-limit.js'
import { relaisKeyVersion, relaisPublicKeyBase64 } from '../../services/secrets/index.js'
import * as transmission from './service.js'
import { cancelByOwner } from '../relay/service.js'
import { chainOnlyBody, emptyBodyAsObject, type ChainOnlyBody } from '../../services/chain/schema.js'
import {
  activateBody,
  configBody,
  contactBody,
  contactParams,
  pauseBody,
  schemaBody,
  verifyBody,
  type ActivateBody,
  type ConfigBody,
  type ContactBody,
  type ContactParams,
  type PauseBody,
  type SchemaBody,
  type VerifyBody,
} from './schemas.js'

export async function transmissionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config', { preHandler: [authenticate] }, async (req) => ok(await transmission.getConfig(req.user!.id)))

  // Bibliothèque des questions secrètes (BO-04) : l'owner choisit, il ne rédige pas.
  app.get('/questions', { preHandler: [authenticate] }, async () => ok(await transmission.listSecretQuestions()))

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

  app.post<{ Body: PauseBody }>(
    '/pause',
    { schema: { body: pauseBody }, preHandler: [authenticate, requireStepUp('edit_transmission')] },
    async (req) => ok(await transmission.pause(req.user!.id, req.body)),
  )

  // Lot 2a : ces trois actions acceptent un corps optionnel { chain } — la signature owner pour la chaîne.
  app.delete<{ Body: ChainOnlyBody }>(
    '/pause',
    { schema: { body: chainOnlyBody }, preValidation: emptyBodyAsObject, preHandler: [authenticate] },
    async (req) => ok(await transmission.resume(req.user!.id, req.body.chain)),
  )

  // L'owner est vivant : il annule lui-même une transmission déclenchée (12/09/2026), sous step-up.
  app.post<{ Body: ChainOnlyBody }>(
    '/cancel',
    { schema: { body: chainOnlyBody }, preValidation: emptyBodyAsObject, preHandler: [authenticate, requireStepUp('cancel_transmission')] },
    async (req) => ok(await cancelByOwner(req.user!.id, new Date(), req.body.chain)),
  )

  app.delete<{ Body: ChainOnlyBody }>(
    '/',
    { schema: { body: chainOnlyBody }, preValidation: emptyBodyAsObject, preHandler: [authenticate, requireStepUp('delete_transmission')] },
    async (req) => ok(await transmission.deactivate(req.user!.id, req.body.chain)),
  )

  app.get<{ Params: ContactParams }>(
    '/contacts/:id/verify-challenge',
    { schema: { params: contactParams }, preHandler: [authenticate] },
    async (req) => ok(await transmission.verifyChallenge(req.user!.id, req.params.id)),
  )

  app.post<{ Params: ContactParams; Body: VerifyBody }>(
    '/contacts/:id/verify',
    { schema: { params: contactParams, body: verifyBody }, preHandler: [authenticate] },
    async (req) => ok(await transmission.verifyContact(req.user!.id, req.params.id, req.body.challenge_id, req.body.signature)),
  )
}
