// Logger hors requête (jobs, services) : même niveau que Fastify, jamais
// d'email, de token ni de blob — les identifiants passent hachés.
import pino from 'pino'
import { env } from '../config/env.js'

let instance: pino.Logger | undefined

export function logger(): pino.Logger {
  instance ??= pino({ level: env().LOG_LEVEL })
  return instance
}
