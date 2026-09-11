// Construction de l'application Fastify. Séparée du bootstrap (index.ts) pour
// que les tests instancient l'app sans ouvrir de port.

import Fastify, { LogController, type FastifyInstance } from 'fastify'
import { env } from './config/env.js'
import { sha256Hex } from './lib/crypto.js'
import { envelopePlugin } from './plugins/envelope.js'
import { securityPlugin } from './plugins/security.js'
import { rateLimitPlugin } from './plugins/rate-limit.js'
import { healthRoutes } from './api/health/routes.js'
import { authRoutes } from './api/auth/routes.js'
import { vaultRoutes } from './api/vault/routes.js'
import { transmissionRoutes } from './api/transmission/routes.js'
import { checkinRoutes } from './api/checkin/routes.js'
import { relayRoutes } from './api/relay/routes.js'
import { journalRoutes } from './api/journal/routes.js'
import { adminRoutes } from './api/admin/routes.js'

// Fastify logge par défaut une ligne à l'arrivée et une au départ de chaque
// requête ; on les coupe et on écrit la nôtre dans onResponse (userId et IP
// hachés, §9.1).
class QuietLogController extends LogController {
  override isLogDisabled(): boolean {
    return true
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env().LOG_LEVEL,
      // Jamais d'IP ni d'identifiant en clair dans les logs (Backend Specs §9.1).
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-step-up-token"]'], censor: '[redacted]' },
    },
    logController: new QuietLogController(),
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MiB — les blobs vault passeront par un endpoint dédié
    ajv: {
      customOptions: {
        // Refuser tout champ inconnu, partout (§7.3)
        removeAdditional: false,
        allErrors: false,
        coerceTypes: false,
      },
    },
  })

  // Une ligne de log par requête, avec userId et IP hachés (§9.1).
  app.addHook('onResponse', async (req, reply) => {
    req.log.info(
      {
        requestId: req.id,
        userId: req.user ? sha256Hex(req.user.id).slice(0, 16) : undefined,
        method: req.method,
        path: req.routeOptions.url ?? req.url,
        statusCode: reply.statusCode,
        duration: Math.round(reply.elapsedTime),
        ip: sha256Hex(req.ip).slice(0, 16),
      },
      'request',
    )
  })

  await app.register(envelopePlugin)
  await app.register(securityPlugin)
  await app.register(rateLimitPlugin)

  await app.register(healthRoutes)
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(vaultRoutes, { prefix: '/vault' })
  await app.register(transmissionRoutes, { prefix: '/transmission' })
  await app.register(checkinRoutes, { prefix: '/checkin' })
  await app.register(relayRoutes, { prefix: '/relay' })
  await app.register(journalRoutes, { prefix: '/journal' })
  await app.register(adminRoutes, { prefix: '/admin' })

  return app
}
