// Toute réponse suit l'enveloppe { success, data | error } (Backend Specs §6.1).
// Les handlers renvoient `ok(data)` ; ce plugin ne s'occupe que des erreurs.

import fp from 'fastify-plugin'
import type { FastifyError, FastifyInstance } from 'fastify'
import { AppError } from '../lib/errors.js'

function isValidationError(err: FastifyError): boolean {
  return Array.isArray((err as { validation?: unknown[] }).validation)
}

export const envelopePlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send(new AppError('NOT_FOUND').toBody())
  })

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.http >= 500) req.log.error({ err }, 'erreur applicative')
      reply.status(err.http).send(err.toBody())
      return
    }

    const fastifyErr = err as FastifyError

    // Schéma JSON refusé par Fastify → VALIDATION_ERROR avec le détail (§7.3)
    if (isValidationError(fastifyErr)) {
      const details = (fastifyErr as { validation?: Array<{ instancePath?: string; message?: string }> }).validation?.map(
        (v) => ({ path: v.instancePath ?? '', message: v.message ?? '' }),
      )
      reply.status(400).send(new AppError('VALIDATION_ERROR', { details }).toBody())
      return
    }

    // Rate limit dépassé (@fastify/rate-limit lève un 429 nu)
    if (fastifyErr.statusCode === 429) {
      reply.status(429).send(new AppError('RATE_LIMITED').toBody())
      return
    }

    // Corps JSON malformé, taille dépassée, etc.
    if (typeof fastifyErr.statusCode === 'number' && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
      reply.status(fastifyErr.statusCode).send(
        new AppError('VALIDATION_ERROR', { message: fastifyErr.message }).toBody(),
      )
      return
    }

    // Tout le reste : 500, loggé, jamais de détail vers le client (§9.1)
    req.log.error({ err: fastifyErr }, 'erreur interne')
    reply.status(500).send(new AppError('INTERNAL_ERROR').toBody())
  })
})
