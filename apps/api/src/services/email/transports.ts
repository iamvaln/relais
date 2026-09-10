import { Resend } from 'resend'
import { env } from '../../config/env.js'
import type { EmailTransport, OutgoingEmail } from './types.js'

/** Dev et tests : affiche l'email, et garde le dernier envoyé pour les assertions. */
export class ConsoleTransport implements EmailTransport {
  readonly name = 'console' as const
  readonly sent: OutgoingEmail[] = []
  constructor(private readonly silent = false) {}

  async send(msg: OutgoingEmail): Promise<{ providerId: string | null }> {
    this.sent.push(msg)
    if (!this.silent) {
      console.log(`\n--- email → ${msg.to}\n${msg.subject}\n\n${msg.text}\n---\n`)
    }
    return { providerId: `console_${this.sent.length}` }
  }

  last(): OutgoingEmail | undefined {
    return this.sent[this.sent.length - 1]
  }

  clear(): void {
    this.sent.length = 0
  }
}

/** Production : Resend (Backend Specs §5.3). */
export class ResendTransport implements EmailTransport {
  readonly name = 'resend' as const
  private readonly client: Resend

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }

  async send(msg: OutgoingEmail): Promise<{ providerId: string | null }> {
    const { data, error } = await this.client.emails.send({
      from: env().EMAIL_FROM,
      to: msg.to,
      replyTo: env().EMAIL_REPLY_TO,
      subject: msg.subject,
      text: msg.text,
    })
    if (error) throw new Error(`Resend : ${error.message}`)
    return { providerId: data?.id ?? null }
  }
}
