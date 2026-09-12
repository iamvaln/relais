// La transmission côté app (E3-US01 à US07, E2-US05, E6-US04, Techniques §7.2).
//
// Le device tient les contacts en clair (ContactStore, chiffré sous K2) ; le
// serveur ne reçoit que ce que crypto-core produit : sealed box vers Relais,
// secret_enc sous K2, parts Shamir sous K_i signées. Les step-ups (DEC-25)
// sont demandés ici ; le PIN, lui, est ressaisi par l'écran avant d'appeler.
//
// Une fois active, la configuration est figée (docs/backend.md) : modifier =
// deactivate() → éditer → activate(). C'est le « parcours guidé » des écrans.

import type { ApiClient } from '@relais/api-client'
import {
  type CategoryKeys,
  type ContactPlan,
  type KeySlot,
  type SigningKeypair,
  buildActivationBody,
  buildContactBody,
  checkVerifyToken,
  deriveContactKey,
  fromBase64,
  openSecret,
  signPayload,
  toBase64,
  wipe,
} from '@relais/crypto-core'
import { type ContactStore, rolesToText } from './store.js'
import { type Answers, type Contact, type ContactInput, type QuestionIds, type Roles, ROLE_SLOTS } from './types.js'

export interface SecretQuestion {
  id: string
  text_fr: string
  text_en: string
  category: string
  reliability_score: number
}

export interface ServerContact {
  id: string
  position: number
  roles: Roles
  question_ids: QuestionIds
  status: string
  shares: Roles
  verify_token: string | null
  verify_last_checked_at: string | null
  secret_enc: string
}

export interface TransmissionConfig {
  status: string
  schema: { n: number; m: number }
  silence_duration_months: number
  checkin_frequency_weeks: number
  pause_until: string | null
  activated_at: string | null
  contacts: ServerContact[]
}

export type SilenceMonths = 1 | 3 | 6
export type CheckinWeeks = 1 | 2 | 4
export type PauseDays = 7 | 30 | 90

export type ActivationProblem =
  | { code: 'too_few_contacts' }
  | { code: 'no_k1_holder' }
  | { code: 'role_holders_below_n'; slot: KeySlot; holders: number }
  | { code: 'schema_m_mismatch'; m: number; contacts: number }
  | { code: 'missing_answers'; contactId: string }

export interface ActivationCheck {
  ok: boolean
  problems: ActivationProblem[]
}

/**
 * Ce que l'écran de récapitulatif vérifie avant de demander le PIN — les
 * mêmes règles que le serveur et que buildActivationBody, dites avant.
 */
export function checkActivation(contacts: Contact[], schema: { n: number; m: number }): ActivationCheck {
  const problems: ActivationProblem[] = []
  if (contacts.length < 2) {
    problems.push({ code: 'too_few_contacts' })
    return { ok: false, problems }
  }
  if (schema.m !== contacts.length) problems.push({ code: 'schema_m_mismatch', m: schema.m, contacts: contacts.length })
  if (!contacts.some((c) => c.roles.k1)) problems.push({ code: 'no_k1_holder' })
  for (const slot of ROLE_SLOTS) {
    const holders = contacts.filter((c) => c.roles[slot]).length
    if (holders > 0 && holders < schema.n) problems.push({ code: 'role_holders_below_n', slot, holders })
  }
  for (const c of contacts) if (!c.answers) problems.push({ code: 'missing_answers', contactId: c.id })
  return { ok: problems.length === 0, problems }
}

export class ActivationBlockedError extends Error {
  constructor(readonly problems: ActivationProblem[]) {
    super(problems.some((p) => p.code === 'missing_answers') ? 'Les réponses secrètes de chaque contact sont nécessaires sur ce device.' : 'La configuration ne permet pas encore l’activation.')
    this.name = 'ActivationBlockedError'
  }
}

export interface TransmissionDeps {
  api: ApiClient
  store: ContactStore
  keys: () => CategoryKeys
  signer: () => SigningKeypair
  /** Prénom que le contact verra dans l'email de désignation (D.2), 60 caractères max. */
  ownerDisplayName?: () => string | undefined
}

export class Transmission {
  private relaisPk: string | null = null

  constructor(private readonly deps: TransmissionDeps) {}

  // --- Lecture ---------------------------------------------------------------------

  async questions(): Promise<SecretQuestion[]> {
    const r = await this.deps.api.get<{ questions: SecretQuestion[] }>('/transmission/questions')
    return r.questions
  }

  config(): Promise<TransmissionConfig> {
    return this.deps.api.get('/transmission/config')
  }

  /** Contacts et schéma ne se modifient que hors activation. */
  async isEditable(): Promise<boolean> {
    return (await this.config()).status === 'inactive'
  }

  private async relaisKey(): Promise<string> {
    this.relaisPk ??= (await this.deps.api.get<{ relais_x25519_pk: string }>('/transmission/relais-key')).relais_x25519_pk
    return this.relaisPk
  }

  private async stepUp(action: 'edit_contacts' | 'edit_transmission' | 'activate_transmission' | 'delete_transmission'): Promise<string> {
    return (await this.deps.api.auth.stepUp(action)).step_up_token
  }

  private plan(c: Contact): ContactPlan {
    if (!c.answers) throw new ActivationBlockedError([{ code: 'missing_answers', contactId: c.id }])
    return this.planWithAnswers(c, c.answers)
  }

  private planWithAnswers(c: Contact, answers: Answers): ContactPlan {
    const owner = this.deps.ownerDisplayName?.()
    return {
      id: c.serverId ?? '',
      roles: c.roles,
      questionIds: c.questionIds,
      answers,
      notification: { email: c.email, phone: c.phone, ...(owner ? { owner_display_name: owner.slice(0, 60) } : {}) },
      secret: { nom: c.name, role: rolesToText(c.roles), message_personnel: c.message, email: c.email, phone: c.phone },
    }
  }

  // --- Contacts (E3-US01 à US03, E2-US05) --------------------------------------------

  /** Crée ou remplace un contact : sur le device d'abord, puis chez Relais. Les réponses ne quittent jamais le device. */
  async saveContact(input: ContactInput, id?: string): Promise<Contact> {
    const cryptoInput = { keys: this.deps.keys(), signer: this.deps.signer(), relaisPk: await this.relaisKey() }
    if (id === undefined) {
      const local = await this.deps.store.add(input)
      const body = await buildContactBody(cryptoInput, this.planWithAnswers(local, local.answers ?? ['', '', '']))
      try {
        const created = await this.deps.api.post<ServerContact>('/transmission/contacts', body)
        return this.deps.store.update(local.id, { serverId: created.id })
      } catch (err) {
        await this.deps.store.remove(local.id)
        throw err
      }
    }
    const current = await this.deps.store.get(id)
    if (!current) throw new Error('contact introuvable')
    const next: Contact = { ...current, ...input }
    const body = await buildContactBody(cryptoInput, this.planWithAnswers(next, next.answers ?? ['', '', '']))
    if (current.serverId) {
      await this.deps.api.put(`/transmission/contacts/${current.serverId}`, body, { stepUpToken: await this.stepUp('edit_contacts') })
      return this.deps.store.update(id, input)
    }
    const created = await this.deps.api.post<ServerContact>('/transmission/contacts', body)
    return this.deps.store.update(id, { ...input, serverId: created.id })
  }

  async removeContact(id: string): Promise<void> {
    const current = await this.deps.store.get(id)
    if (!current) return
    if (current.serverId) {
      await this.deps.api.delete(`/transmission/contacts/${current.serverId}`, undefined, { stepUpToken: await this.stepUp('edit_contacts') })
    }
    await this.deps.store.remove(id)
  }

  // --- Schéma et délais (E3-US01, E3-US05) ------------------------------------------

  async setSchema(schema: { n: number; m: number }): Promise<TransmissionConfig> {
    return this.deps.api.put('/transmission/schema', schema, { stepUpToken: await this.stepUp('edit_contacts') })
  }

  async setConfig(config: { silence_duration_months: SilenceMonths; checkin_frequency_weeks: CheckinWeeks }): Promise<TransmissionConfig> {
    return this.deps.api.put('/transmission/config', config, { stepUpToken: await this.stepUp('edit_transmission') })
  }

  // --- Activation, désactivation (E3-US06, E3-US07) -----------------------------------

  /** Parts Shamir calculées sur le device à partir des réponses, puis POST /activate sous step-up. */
  async activate(): Promise<{ activated: true; contacts_notified: number }> {
    const cfg = await this.config()
    const contacts = await this.deps.store.list()
    const check = checkActivation(contacts, { n: cfg.schema.n, m: contacts.length })
    if (!check.ok) throw new ActivationBlockedError(check.problems)
    const body = await buildActivationBody({
      keys: this.deps.keys(),
      signer: this.deps.signer(),
      relaisPk: await this.relaisKey(),
      contacts: contacts.map((c) => this.plan(c)),
      schema: { n: cfg.schema.n, m: contacts.length },
      silence_duration_months: cfg.silence_duration_months,
      checkin_frequency_weeks: cfg.checkin_frequency_weeks,
    })
    return this.deps.api.post('/transmission/activate', body, { stepUpToken: await this.stepUp('activate_transmission') })
  }

  async deactivate(): Promise<{ deactivated: true }> {
    return this.deps.api.delete('/transmission', undefined, { stepUpToken: await this.stepUp('delete_transmission') })
  }

  // --- Pause (E6-US04) ----------------------------------------------------------------

  async pause(days: PauseDays): Promise<TransmissionConfig> {
    return this.deps.api.post('/transmission/pause', { duration_days: days }, { stepUpToken: await this.stepUp('edit_transmission') })
  }

  resume(): Promise<TransmissionConfig> {
    return this.deps.api.delete('/transmission/pause')
  }

  // --- Vérification annuelle (Techniques §7.2) ------------------------------------------

  /**
   * L'owner ressaisit les réponses ; verify_token s'ouvre (ou non) sur le
   * device. Vrai → attestation signée, datée par le serveur, et les réponses
   * sont gardées sur ce device si elles n'y étaient pas.
   */
  async verifyContact(id: string, answers: Answers): Promise<{ verified: boolean }> {
    const local = await this.deps.store.get(id)
    if (!local?.serverId) throw new Error('contact introuvable')
    const server = (await this.config()).contacts.find((c) => c.id === local.serverId)
    if (!server?.verify_token) throw new Error('Activez la transmission avant la vérification annuelle.')
    const contactKey = await deriveContactKey(answers, local.questionIds)
    let verified: boolean
    try {
      verified = await checkVerifyToken(contactKey, server.verify_token)
    } finally {
      wipe(contactKey)
    }
    if (!verified) return { verified: false }
    const signature = await signPayload(fromBase64(server.verify_token), this.deps.signer().privateKey)
    await this.deps.api.post(`/transmission/contacts/${local.serverId}/verify`, { signature: toBase64(signature) })
    if (!local.answers) await this.deps.store.update(id, { answers })
    return { verified: true }
  }

  // --- Restauration sur un nouveau device --------------------------------------------------

  /** Relit les contacts depuis secret_enc (K2). Les réponses déjà connues sur ce device sont conservées. */
  async restore(): Promise<number> {
    const cfg = await this.config()
    const known = new Map((await this.deps.store.list()).filter((c) => c.serverId).map((c) => [c.serverId!, c]))
    const k2 = this.deps.keys().k2
    const contacts = []
    for (const s of cfg.contacts) {
      const secret = await openSecret(k2, s.secret_enc)
      contacts.push({
        serverId: s.id,
        position: s.position,
        name: secret.nom,
        email: secret.email ?? known.get(s.id)?.email ?? '',
        phone: secret.phone ?? known.get(s.id)?.phone ?? null,
        message: secret.message_personnel,
        roles: s.roles,
        questionIds: s.question_ids,
        answers: known.get(s.id)?.answers ?? null,
      })
    }
    await this.deps.store.replaceAll(contacts)
    return contacts.length
  }
}
