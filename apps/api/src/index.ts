import { buildApp } from './app.js'
import { env } from './config/env.js'
import { disconnectPrisma } from './lib/prisma.js'
import { disconnectRedis } from './lib/redis.js'
import { startJobs, stopJobs } from './jobs/queue.js'

async function main(): Promise<void> {
  const config = env()
  const app = await buildApp()

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'arrêt')
    await app.close()
    await stopJobs()
    await Promise.all([disconnectPrisma(), disconnectRedis()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  if (config.JOBS_ENABLED === 'true') {
    await startJobs()
    app.log.info('jobs BullMQ démarrés (deadman:checkin, 09:00 UTC)')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
