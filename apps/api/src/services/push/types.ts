export type PushType = 'checkin_due' | 'checkin_relance_1' | 'pause_ending'

/** Ce qui part vers le fournisseur : jamais d'email, de nom ni de contenu utilisateur. */
export interface OutgoingPush {
  /** SHA256(user_id) — l'alias OneSignal, jamais l'identifiant lui-même. */
  externalId: string
  title: string
  body: string
  /** Écran à ouvrir dans l'app. */
  route: string
}

export interface PushTransport {
  readonly name: 'console' | 'onesignal'
  send(msg: OutgoingPush): Promise<{ providerId: string | null }>
}
