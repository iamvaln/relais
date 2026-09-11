// Activation côté owner (Techniques §4, §5.3 ; POST /transmission/activate).
//
// Pour chaque catégorie j : les porteurs du rôle kj, dans l'ordre des contacts,
// reçoivent les parts d'un découpage N-of-|porteurs| de Kj. Il faut donc au
// moins N porteurs par rôle, sinon la catégorie ne pourrait jamais se
// déverrouiller (le serveur compte N parts par catégorie). M = nombre de
// contacts, comme l'API l'exige. Les clés de réponses K_i ne vivent que le
// temps de chiffrer les parts et le verify_token.

import {
  type Answers,
  type NotificationClear,
  type PreparedShare,
  type QuestionIds,
  type SecretClear,
  buildVerifyToken,
  deriveContactKey,
  encryptSecret,
  prepareShare,
  sealNotification,
} from './contacts.js'
import { type CategoryKeys, type KeySlot, type SigningKeypair, wipe } from './keys.js'
import { split } from './shamir.js'

export type Roles = Record<KeySlot, boolean>
const SLOTS: KeySlot[] = ['k1', 'k2', 'k3']

export interface ContactPlan {
  /** Identifiant du contact déjà créé par POST /transmission/contacts. */
  id: string
  roles: Roles
  questionIds: QuestionIds
  answers: Answers
  notification: NotificationClear
  secret: SecretClear
}

export interface ActivationInput {
  keys: CategoryKeys
  signer: SigningKeypair
  relaisPk: string
  contacts: ContactPlan[]
  schema: { n: number; m: number }
  silence_duration_months: number
  checkin_frequency_weeks: number
}

export interface ActivationContactBody {
  id: string
  notification_enc: string
  notification_sig: string
  secret_enc: string
  roles: Roles
  question_ids: QuestionIds
  shares: Record<KeySlot, PreparedShare | null>
  verify_token: string
}

export interface ActivationBody {
  silence_duration_months: number
  checkin_frequency_weeks: number
  schema: { n: number; m: number }
  contacts: ActivationContactBody[]
}

/** Corps de POST /transmission/contacts pour un contact (sans les parts). */
export async function buildContactBody(input: Pick<ActivationInput, 'keys' | 'signer' | 'relaisPk'>, c: ContactPlan) {
  const sealed = await sealNotification(input.relaisPk, c.notification, input.signer.privateKey)
  return {
    ...sealed,
    secret_enc: await encryptSecret(input.keys.k2, c.secret),
    roles: c.roles,
    question_ids: c.questionIds,
  }
}

export async function buildActivationBody(input: ActivationInput): Promise<ActivationBody> {
  const { contacts, schema } = input
  if (schema.m !== contacts.length) throw new Error(`M (${schema.m}) doit être le nombre de contacts (${contacts.length})`)

  // Parts par rôle : N-of-|porteurs|, la i-ème part au i-ème porteur.
  const assigned = new Map<string, Partial<Record<KeySlot, Uint8Array>>>(contacts.map((c) => [c.id, {}]))
  for (const slot of SLOTS) {
    const holders = contacts.filter((c) => c.roles[slot])
    if (holders.length === 0) continue
    if (holders.length < schema.n) throw new Error(`rôle ${slot} : ${holders.length} porteur(s), il en faut au moins N = ${schema.n}`)
    const shares = split(input.keys[slot], schema.n, holders.length)
    holders.forEach((c, i) => {
      assigned.get(c.id)![slot] = shares[i]!
    })
  }

  const out: ActivationContactBody[] = []
  for (const c of contacts) {
    const contactKey = await deriveContactKey(c.answers, c.questionIds)
    try {
      const shares = {} as Record<KeySlot, PreparedShare | null>
      for (const slot of SLOTS) {
        const share = assigned.get(c.id)![slot]
        shares[slot] = share ? await prepareShare(share, contactKey, input.signer.privateKey) : null
        if (share) wipe(share)
      }
      out.push({
        id: c.id,
        ...(await buildContactBody(input, c)),
        shares,
        verify_token: await buildVerifyToken(contactKey),
      })
    } finally {
      wipe(contactKey)
    }
  }
  return {
    silence_duration_months: input.silence_duration_months,
    checkin_frequency_weeks: input.checkin_frequency_weeks,
    schema,
    contacts: out,
  }
}
