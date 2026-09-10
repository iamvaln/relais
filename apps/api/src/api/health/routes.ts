// GET /health (Backend Specs §9.2). Sans authentification, 60 req/min/IP.

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import { limits } from '../../plugins/rate-limit.js'
import { env } from '../../config/env.js'

type ServiceStatus = 'ok' | 'degraded' | 'down' | 'unconfigured'

const startedAt = Date.now()

async function probe(fn: () => Promise<unknown>): Promise<ServiceStatus> {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2_000))])
    return 'ok'
  } catch {
    return 'down'
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: limits.health } }, async (_req, reply) => {
    const [postgres, redisStatus] = await Promise.all([
      probe(() => prisma().$queryRaw`SELECT 1`),
      probe(() => redis().ping()),
    ])

    const services: Record<string, ServiceStatus> = {
      postgres,
      redis: redisStatus,
      email: env().EMAIL_TRANSPORT === 'resend' ? 'ok' : 'unconfigured',
      // Intégrations à venir — déclarées pour que le back office (BO-06)
      // les voie déjà, sans prétendre qu'elles tournent.
      storj: 'unconfigured',
    }

    const critical = [postgres, redisStatus]
    const status: ServiceStatus = critical.every((s) => s === 'ok')
      ? 'ok'
      : critical.some((s) => s === 'down')
        ? 'down'
        : 'degraded'

    reply.status(status === 'down' ? 503 : 200)
    return ok({ status, services, uptime: Math.floor((Date.now() - startedAt) / 1000) })
  })
}
