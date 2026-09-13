// GET /health (Backend Specs §9.2). Sans authentification, 60 req/min/IP.

import type { FastifyInstance } from 'fastify'
import { ok } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import { limits } from '../../plugins/rate-limit.js'
import { env } from '../../config/env.js'
import { objectStore } from '../../services/storage/index.js'
import { chainService } from '../../services/chain/index.js'
import { probeHcv } from '../../services/secrets/index.js'

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

export interface HealthReport {
  status: ServiceStatus
  services: Record<string, ServiceStatus>
  uptime: number
}

export async function healthReport(): Promise<HealthReport> {
    const hcvAddr = env().HCV_ADDR
    const chain = chainService()
    const [postgres, redisStatus, storage, hcv, chainStatus] = await Promise.all([
      probe(() => prisma().$queryRaw`SELECT 1`),
      probe(() => redis().ping()),
      probe(() => objectStore().ping()),
      hcvAddr ? probe(() => probeHcv(hcvAddr)) : Promise.resolve<ServiceStatus>('unconfigured'),
      chain.enabled ? probe(() => chain.blockNumber()) : Promise.resolve<ServiceStatus>('unconfigured'),
    ])

    const services: Record<string, ServiceStatus> = {
      postgres,
      redis: redisStatus,
      email: env().EMAIL_TRANSPORT === 'resend' ? 'ok' : 'unconfigured',
      storj: env().STORAGE_BACKEND === 's3' ? storage : storage === 'ok' ? 'unconfigured' : storage,
      // BO-01 « HCV indisponible » : sondé dès que HCV est configuré (obligatoire en production)
      hcv,
      // Lot 2a : le RPC de la chaîne, sondé dès que CHAIN_ENABLED
      chain: chainStatus,
    }

    const critical = [postgres, redisStatus]
    const status: ServiceStatus = critical.every((s) => s === 'ok')
      ? 'ok'
      : critical.some((s) => s === 'down')
        ? 'down'
        : 'degraded'

    return { status, services, uptime: Math.floor((Date.now() - startedAt) / 1000) }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: limits.health } }, async (_req, reply) => {
    const report = await healthReport()
    reply.status(report.status === 'down' ? 503 : 200)
    return ok(report)
  })
}
