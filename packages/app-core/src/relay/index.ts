// Le parcours du contact (E5-US01 à US05, F4, Techniques §6.7–6.8), partagé
// par l'app (deep link) et la page web. Tout ce qui est secret se passe sur
// le device : réponses → K_i → parts déchiffrées ; N parts → Kj → coffre.
// Décision du 12/09/2026 : les données en clair ne vivent qu'en mémoire ;
// seule la progression « Fait » est gardée localement, sous le hachage du
// token, et disparaît avec l'accès (escrow + 30 jours).

import type { ApiClient } from '@relais/api-client'
import { type Answers, type EntryClear, type KeySlot, type SecretClear, answerRelay, fromBase64, open, openSecret, ready, reconstruct, sha256, wipe } from '@relais/crypto-core'
import type { SecureStorage } from '../secure-storage.js'
import { type EncryptedRow, type Urgency, URGENCIES, type VaultCategory, type VaultItem } from '../vault/types.js'

export interface RelayQuestion {
  id: string
  text_fr: string
  text_en: string
}

export interface RelayLinkView {
  owner_name: string
  status: string
  contact_status: string
  schema: { n: number; m: number }
  answered: number
  roles: Record<KeySlot, boolean>
  questions: RelayQuestion[]
  verify_token: string | null
  shares_enc: Record<KeySlot, string | null>
  secret_enc: string
  expires_at: string
  escrow_expires_at: string
}

export interface RelayStatusView {
  status: string
  contact_status: string
  answered: number
  needed: number
  total: number
  unlocked: Record<KeySlot, boolean>
  escrow_expires_at: string
}

export type RelayAnswerResult = { ok: false; attempts_left: number } | { ok: true; answered: number; needed: number; unlocked: Record<KeySlot, boolean> }

export interface ChecklistSection {
  urgency: Urgency
  items: VaultItem[]
}

export interface ContactAccess {
  owner_name: string
  /** Le message personnel (sous K2) : présent si le contact porte K2. */
  message: SecretClear | null
  unlocked: Record<KeySlot, boolean>
  categories: Partial<Record<VaultCategory, VaultItem[]>>
  /** E2-US07 : le carnet, pour le Gardien du souvenir. */
  journal?: EntryClear[]
  checklist: ChecklistSection[]
  /** E5-US04 : escrow + 30 jours. */
  access_expires_at: string
}

export type RelayPhase = 'questions' | 'waiting' | 'access' | 'done'

/** F4 : où en est ce contact — questions à répondre, attente des autres, accès ouvert pour l'un de ses rôles, terminé. */
export function phaseOf(link: Pick<RelayLinkView, 'contact_status' | 'roles'>, status: Pick<RelayStatusView, 'unlocked'>): RelayPhase {
  if (link.contact_status === 'confirmed') return 'done'
  if (link.contact_status !== 'answered') return 'questions'
  const slots: KeySlot[] = ['k1', 'k2', 'k3']
  return slots.some((s) => link.roles[s] && status.unlocked[s]) ? 'access' : 'waiting'
}

const ACCESS_DAYS = 30
const DAY_MS = 24 * 3600 * 1000
const SLOT_CATEGORY: Record<KeySlot, VaultCategory> = { k1: 'accounts', k2: 'messages', k3: 'finances' }

/** E5-US04 : Immédiat / Sous 30 jours / À votre discrétion, toutes catégories confondues, dans l'ordre d'origine. */
export function checklist(categories: Partial<Record<VaultCategory, VaultItem[]>>): ChecklistSection[] {
  const all = Object.values(categories).flat()
  return URGENCIES.map((urgency) => ({ urgency, items: all.filter((i) => i.urgency === urgency) }))
}

interface StoredProgress {
  done: string[]
  expires_at: string
}

/** La progression « Fait », par lien, sous le hachage du token — jamais le token lui-même. */
export class RelayProgress {
  constructor(
    private readonly storage: SecureStorage,
    private readonly now: () => number = Date.now,
  ) {}

  private async key(token: string): Promise<string> {
    await ready()
    return `relais.relay.${Buffer.from(sha256(new TextEncoder().encode(token))).toString('hex').slice(0, 32)}`
  }

  private async read(token: string): Promise<{ key: string; progress: StoredProgress | null }> {
    const key = await this.key(token)
    const raw = await this.storage.get(key)
    if (!raw) return { key, progress: null }
    const progress = JSON.parse(raw) as StoredProgress
    if (Date.parse(progress.expires_at) <= this.now()) {
      await this.storage.delete(key)
      return { key, progress: null }
    }
    return { key, progress }
  }

  async done(token: string): Promise<string[]> {
    return (await this.read(token)).progress?.done ?? []
  }

  async mark(token: string, itemId: string, done: boolean, expiresAt: string): Promise<void> {
    const { key, progress } = await this.read(token)
    const set = new Set(progress?.done ?? [])
    if (done) set.add(itemId)
    else set.delete(itemId)
    await this.storage.set(key, JSON.stringify({ done: [...set], expires_at: progress?.expires_at ?? expiresAt } satisfies StoredProgress))
  }

  async clear(token: string): Promise<void> {
    await this.storage.delete(await this.key(token))
  }
}

export interface RelayFlowDeps {
  api: ApiClient
  storage: SecureStorage
  now?: () => number
}

type Secret = Pick<VaultItem, 'service_name' | 'login' | 'password' | 'instructions' | 'notes'>

export class RelayFlow {
  private readonly progressStore: RelayProgress

  constructor(private readonly deps: RelayFlowDeps) {
    this.progressStore = new RelayProgress(deps.storage, deps.now)
  }

  link(token: string): Promise<RelayLinkView> {
    return this.deps.api.get(`/relay/${token}`)
  }

  status(token: string): Promise<RelayStatusView> {
    return this.deps.api.get(`/relay/${token}/status`)
  }

  /**
   * E5-US02 : les réponses sont vérifiées ici avec verify_token. Fausses →
   * l'échec est déclaré (le serveur compte les tentatives) ; justes → les
   * parts déchiffrées partent en escrow. Les réponses ne quittent pas le device.
   */
  async answer(token: string, link: RelayLinkView, answers: Answers): Promise<RelayAnswerResult> {
    const local = await answerRelay(link, answers)
    if (!local.ok) {
      const r = await this.deps.api.post<{ accepted: false; attempts_left: number }>(`/relay/${token}/verify`, { failed: true })
      return { ok: false, attempts_left: r.attempts_left }
    }
    const r = await this.deps.api.post<{ accepted: true; answered: number; needed: number; unlocked: Record<KeySlot, boolean> }>(`/relay/${token}/verify`, { shares: local.shares })
    return { ok: true, answered: r.answered, needed: r.needed, unlocked: r.unlocked }
  }

  /** E5-US04 : N parts → Kj → coffre déchiffré en mémoire ; message personnel et carnet si K2. Les clés sont effacées avant de rendre. */
  async unlock(token: string): Promise<ContactAccess> {
    const [link, status, data] = await Promise.all([
      this.link(token),
      this.status(token),
      this.deps.api.get<{ secret_enc: string; categories: Partial<Record<KeySlot, { category: string; shares: string[]; p2: string | null }>>; journal?: { month: string; mode: string; content_enc: string }[] }>(
        `/relay/${token}/data`,
      ),
    ])
    const rec = await reconstruct(data)
    const categories: ContactAccess['categories'] = {}
    let message: SecretClear | null = null
    let journal: EntryClear[] | undefined
    try {
      for (const slot of Object.keys(rec.categories) as KeySlot[]) {
        const cat = rec.categories[slot]!
        const items: VaultItem[] = []
        if (cat.data) {
          const rows = JSON.parse(Buffer.from(cat.data).toString('utf8')) as EncryptedRow[]
          wipe(cat.data)
          for (const row of rows) {
            const clear = await open(cat.key, fromBase64(row.payload))
            const secret = JSON.parse(Buffer.from(clear).toString('utf8')) as Secret
            wipe(clear)
            items.push({ id: row.id, category: row.category, urgency: row.urgency, created_at: row.created_at, updated_at: row.updated_at, ...secret })
          }
        }
        categories[SLOT_CATEGORY[slot]] = items
        if (slot === 'k2') {
          message = await openSecret(cat.key, data.secret_enc)
          if (data.journal) {
            journal = []
            for (const e of data.journal) {
              const clear = await open(cat.key, fromBase64(e.content_enc))
              journal.push(JSON.parse(Buffer.from(clear).toString('utf8')) as EntryClear)
              wipe(clear)
            }
          }
        }
      }
    } finally {
      for (const cat of Object.values(rec.categories)) wipe(cat.key)
    }
    return {
      owner_name: link.owner_name,
      message,
      unlocked: status.unlocked,
      categories,
      ...(journal ? { journal } : {}),
      checklist: checklist(categories),
      access_expires_at: new Date(Date.parse(link.escrow_expires_at) + ACCESS_DAYS * DAY_MS).toISOString(),
    }
  }

  progress(token: string): Promise<string[]> {
    return this.progressStore.done(token)
  }

  markDone(token: string, itemId: string, done: boolean, accessExpiresAt: string): Promise<void> {
    return this.progressStore.mark(token, itemId, done, accessExpiresAt)
  }

  /** E5-US05 : « J'ai terminé ». La progression locale n'a plus de raison d'être. */
  async confirm(token: string): Promise<{ confirmed: true; transmission_status: string }> {
    const r = await this.deps.api.post<{ confirmed: true; transmission_status: string }>(`/relay/${token}/confirm`)
    await this.progressStore.clear(token)
    return r
  }
}
