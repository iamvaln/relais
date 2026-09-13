// Ce que l'app signe pour la chaîne Arbitrum (docs/smart-contract-v2.md D1, §4 ;
// lot 3a). Le champ `chain` d'une action qui engage le minuteur : la date que
// l'app choisit (alignée au jour supérieur — l'API la borne à ± 2 jours de la
// sienne), et la signature Ed25519 du seed sur le message canonique de
// `crypto-core`. Sujet on-chain absent → c'est un `register`, avec les
// paramètres d'enregistrement. L'app ne sait pas si l'API a la chaîne
// activée et n'a pas à le savoir : le serveur ignore le champ sinon.

import { chainSubject, signChainAction, type ChainAction, type ChainFields, type SigningKeypair } from '@relais/crypto-core'

const DAY_S = 86_400
const WEEK_S = 7 * DAY_S
const MONTH_DAYS = 30

/** Le champ `chain` tel que l'API le lit. */
export interface ChainField {
  action?: 'register'
  next_due?: number
  paused_until?: number
  sig: string
}


export interface ChainFieldOptions {
  now?: Date
  checkinFrequencyWeeks: number
  /** Requis quand le compte n'a pas encore de sujet on-chain : n, contacts porteurs, silence en mois. */
  register?: { n: number; m: number; silenceMonths: number }
  /** Requis pour `pause`. */
  pauseDays?: number
  /**
   * L'échéance courante en base (ISO), si connue : le contrat exige une
   * échéance strictement croissante, l'app signe donc au moins un jour de
   * plus que l'ancienne — ce qui reste dans la tolérance de l'API (± 2 jours).
   */
  previousDue?: string | null | undefined
}

/** Le premier minuit UTC strictement après `date`, en secondes Unix. */
export function ceilDay(date: Date): number {
  return (Math.floor(date.getTime() / 1000 / DAY_S) + 1) * DAY_S
}

export function nextDueFor(now: Date, checkinFrequencyWeeks: number, previousDue?: string | null): number {
  const candidate = ceilDay(new Date(now.getTime() + checkinFrequencyWeeks * WEEK_S * 1000))
  if (!previousDue) return candidate
  const previous = new Date(previousDue)
  if (Number.isNaN(previous.getTime())) return candidate
  return Math.max(candidate, ceilDay(previous) + DAY_S)
}

export function pausedUntilFor(now: Date, days: number): number {
  return ceilDay(new Date(now.getTime() + days * DAY_S * 1000))
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/**
 * Construit et signe le champ `chain` d'une action. `subject` est celui que
 * l'API rend dans `GET /transmission/config` (`chain.subject`), null tant que
 * le compte n'est pas enregistré : l'action devient alors `register`.
 * L'activation demande `register` explicitement, sujet ou pas.
 */
export async function chainFieldFor(signer: SigningKeypair, subject: string | null, action: ChainAction, opts: ChainFieldOptions): Promise<ChainField> {
  const now = opts.now ?? new Date()
  const own = chainSubject(signer.publicKey)
  if (subject !== null && subject.toLowerCase() !== own) throw new Error('chaîne : le sujet ne correspond pas à la clé de ce compte')

  if (subject === null || action === 'register') {
    if (!opts.register) throw new Error('chaîne : paramètres de register requis pour un compte sans sujet')
    const next_due = nextDueFor(now, opts.checkinFrequencyWeeks)
    const fields: ChainFields = {
      nextDue: next_due,
      n: opts.register.n,
      m: opts.register.m,
      silenceSecs: opts.register.silenceMonths * MONTH_DAYS * DAY_S,
      checkinFreqSecs: opts.checkinFrequencyWeeks * WEEK_S,
    }
    return { action: 'register', next_due, sig: toBase64(await signChainAction(signer.privateKey, 'register', own, fields)) }
  }

  if (action === 'pause') {
    if (opts.pauseDays === undefined) throw new Error('chaîne : durée de pause requise')
    const paused_until = pausedUntilFor(now, opts.pauseDays)
    return { paused_until, sig: toBase64(await signChainAction(signer.privateKey, 'pause', own, { pausedUntil: paused_until })) }
  }
  if (action === 'deactivate') {
    return { sig: toBase64(await signChainAction(signer.privateKey, 'deactivate', own, {})) }
  }
  const next_due = nextDueFor(now, opts.checkinFrequencyWeeks, opts.previousDue)
  return { next_due, sig: toBase64(await signChainAction(signer.privateKey, action, own, { nextDue: next_due })) }
}
