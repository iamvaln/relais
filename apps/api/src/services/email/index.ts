// Service email : rend un template, envoie, et trace CHAQUE envoi dans
// email_log (DEC-24) — avec le hash de l'adresse, jamais l'adresse elle-même.

import { env } from '../../config/env.js'
import { sha256Hex } from '../../lib/crypto.js'
import { prisma } from '../../lib/prisma.js'
import { renderEmail } from './templates.js'
import { ConsoleTransport, ResendTransport } from './transports.js'
import type { EmailTransport, SendOptions } from './types.js'

export class EmailService {
  constructor(readonly transport: EmailTransport) {}

  /**
   * Ne lève jamais : un email qui ne part pas ne doit pas casser une
   * inscription. L'échec est tracé dans email_log (status 'failed') et loggé.
   */
  async send(opts: SendOptions): Promise<{ logId: string; sent: boolean }> {
    const rendered = renderEmail(opts.type, opts.locale, opts.params)
    const recipientHash = sha256Hex(opts.to.trim().toLowerCase())

    let providerId: string | null = null
    let status: 'sent' | 'failed' = 'sent'
    let errorMessage: string | null = null

    try {
      const result = await this.transport.send({ to: opts.to, subject: rendered.subject, text: rendered.text })
      providerId = result.providerId
    } catch (err) {
      status = 'failed'
      errorMessage = err instanceof Error ? err.message.slice(0, 500) : 'unknown'
    }

    const log = await prisma().email_log.create({
      data: {
        user_id: opts.userId ?? null,
        recipient_hash: recipientHash,
        email_type: opts.type,
        provider_id: providerId,
        status,
        error_message: errorMessage,
      },
      select: { id: true },
    })

    return { logId: log.id, sent: status === 'sent' }
  }
}

let instance: EmailService | undefined

export function emailService(): EmailService {
  if (!instance) {
    const e = env()
    const transport =
      e.EMAIL_TRANSPORT === 'resend' && e.RESEND_API_KEY
        ? new ResendTransport(e.RESEND_API_KEY)
        : new ConsoleTransport(e.NODE_ENV === 'test')
    instance = new EmailService(transport)
  }
  return instance
}

/** Pour les tests : injecter un transport contrôlé. */
export function setEmailServiceForTests(service: EmailService): void {
  instance = service
}

export { ConsoleTransport }
export type { EmailType, Locale } from './types.js'
