import type { OutgoingPush, PushTransport } from './types.js'

/** Dev et tests : garde ce qui serait parti. */
export class ConsolePushTransport implements PushTransport {
  readonly name = 'console' as const
  readonly sent: OutgoingPush[] = []
  constructor(private readonly silent = false) {}

  async send(msg: OutgoingPush): Promise<{ providerId: string | null }> {
    this.sent.push(msg)
    if (!this.silent) console.log(`\n--- push → ${msg.externalId.slice(0, 8)}… : ${msg.title}\n${msg.body}\n---\n`)
    return { providerId: `console_${this.sent.length}` }
  }

  clear(): void {
    this.sent.length = 0
  }
}

export interface OneSignalOptions {
  appId: string
  restApiKey: string
  apiUrl?: string
}

/**
 * Production : API REST OneSignal (POST /notifications), ciblage par alias
 * external_id. La clé REST vit dans l'environnement (DEC-18) et n'apparaît
 * jamais dans une erreur.
 */
export class OneSignalTransport implements PushTransport {
  readonly name = 'onesignal' as const
  private readonly apiUrl: string

  constructor(private readonly options: OneSignalOptions) {
    this.apiUrl = (options.apiUrl ?? 'https://api.onesignal.com').replace(/\/$/, '')
  }

  async send(msg: OutgoingPush): Promise<{ providerId: string | null }> {
    const res = await fetch(`${this.apiUrl}/notifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${this.options.restApiKey}` },
      body: JSON.stringify({
        app_id: this.options.appId,
        target_channel: 'push',
        include_aliases: { external_id: [msg.externalId] },
        headings: { en: msg.title },
        contents: { en: msg.body },
        data: { route: msg.route },
      }),
    })
    if (!res.ok) throw new Error(`OneSignal : HTTP ${res.status}`)
    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return { providerId: body.id ?? null }
  }
}
