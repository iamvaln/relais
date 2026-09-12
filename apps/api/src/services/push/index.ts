// Service push (lot 5 mobile, décision du 12/09/2026) : l'utilisateur est
// ciblé par external_id = SHA256(user_id) ; l'envoi n'a lieu que si le compte
// a au moins un abonnement actif (push_tokens). Aucune trace en base : les
// envois sont déterministes (fenêtres du jour du job) et sans donnée.
// Ne lève jamais : un push qui ne part pas ne casse pas le job.

import { env } from '../../config/env.js'
import { sha256Hex } from '../../lib/crypto.js'
import { prisma } from '../../lib/prisma.js'
import type { Locale } from '../email/types.js'
import { renderPush } from './templates.js'
import { ConsolePushTransport, OneSignalTransport } from './transports.js'
import type { PushTransport, PushType } from './types.js'

export function pushExternalId(userId: string): string {
  return sha256Hex(userId)
}

export type PushResult = { sent: true } | { sent: false; reason: 'no_subscription' | 'failed' }

export class PushService {
  constructor(readonly transport: PushTransport) {}

  async send(opts: { userId: string; type: PushType; locale: Locale }): Promise<PushResult> {
    const active = await prisma().push_tokens.count({ where: { user_id: opts.userId, active: true } })
    if (active === 0) return { sent: false, reason: 'no_subscription' }
    const text = renderPush(opts.type, opts.locale)
    try {
      await this.transport.send({ externalId: pushExternalId(opts.userId), ...text })
      return { sent: true }
    } catch {
      return { sent: false, reason: 'failed' }
    }
  }
}

let instance: PushService | undefined

export function pushService(): PushService {
  if (!instance) {
    const e = env()
    const transport =
      e.PUSH_TRANSPORT === 'onesignal' && e.ONESIGNAL_APP_ID && e.ONESIGNAL_REST_API_KEY
        ? new OneSignalTransport({ appId: e.ONESIGNAL_APP_ID, restApiKey: e.ONESIGNAL_REST_API_KEY, apiUrl: e.ONESIGNAL_API_URL })
        : new ConsolePushTransport(e.NODE_ENV === 'test')
    instance = new PushService(transport)
  }
  return instance
}

/** Pour les tests : injecter un transport contrôlé. */
export function setPushServiceForTests(service: PushService): void {
  instance = service
}

export { ConsolePushTransport, OneSignalTransport }
export type { PushType, OutgoingPush, PushTransport } from './types.js'
