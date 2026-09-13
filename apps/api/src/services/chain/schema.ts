// Le champ optionnel `chain` des actions qui engagent le minuteur on-chain
// (activation, check-in, pause, reprise, annulation, désactivation) : ce que
// l'app a signé — la date qu'elle a choisie, alignée au jour, et la signature.

const base64 = { type: 'string', pattern: '^[A-Za-z0-9+/_-]+={0,2}$' } as const

export const chainField = {
  type: 'object',
  required: ['sig'],
  additionalProperties: false,
  properties: {
    /** Par défaut l'action de l'endpoint ; `register` est admis au check-in d'un compte activé avant la chaîne. */
    action: { type: 'string', enum: ['register', 'checkin', 'pause', 'resume', 'cancelTrigger', 'deactivate'] },
    /** Échéance signée, secondes Unix alignées au jour. */
    next_due: { type: 'integer', minimum: 0 },
    /** Fin de pause signée, secondes Unix alignées au jour. */
    paused_until: { type: 'integer', minimum: 0 },
    /** Ed25519(SHA256(message canonique)), 64 octets. */
    sig: { ...base64, maxLength: 128 },
  },
} as const

export interface ChainField {
  action?: 'register' | 'checkin' | 'pause' | 'resume' | 'cancelTrigger' | 'deactivate'
  next_due?: number
  paused_until?: number
  sig: string
}

/** Corps réduit au champ `chain`, pour les endpoints qui n'en avaient pas (reprise, annulation, désactivation). */
export const chainOnlyBody = {
  type: 'object',
  additionalProperties: false,
  properties: { chain: chainField },
} as const

export interface ChainOnlyBody {
  chain?: ChainField
}

/**
 * Un DELETE ou un POST sans corps arrive avec `body` indéfini, que le schéma
 * refuserait : on le remplace par {} avant la validation (hook preValidation).
 */
export function emptyBodyAsObject(req: { body: unknown }, _reply: unknown, done: () => void): void {
  if (req.body === undefined || req.body === null) req.body = {}
  done()
}
