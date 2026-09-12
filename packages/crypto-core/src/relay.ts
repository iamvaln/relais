// Côté contact, post-mortem (Techniques §5.6, DEC-13/14, E5-US02 à E5-US04).
// Tout se passe sur le device du contact : Relais ne voit ni réponses ni K_i.
//
//   answerRelay : réponses → K_i (sel depuis les question_id du lien) →
//                 verify_token s'ouvre ? sinon { ok: false } (l'app déclare
//                 { failed: true }) ; sinon les parts détenues, déchiffrées,
//                 prêtes pour POST /relay/:token/verify { shares }
//   reconstruct : GET /relay/:token/data → pour chaque catégorie, N parts →
//                 Kj → P2 ouvert (mémoire vive). Ce que P2 scelle est ce que
//                 l'owner a déposé : dans l'app, la liste JSON des fiches
//                 chiffrées une à une (P1 par fiche, packages/app-core) — la
//                 couche suivante appartient donc à l'app, pas au cœur.

import { open } from './aead.js'
import { type Answers, type QuestionIds, type SecretClear, checkVerifyToken, deriveContactKey } from './contacts.js'
import { type KeySlot, wipe } from './keys.js'
import { combine } from './shamir.js'
import { fromBase64, toBase64 } from './vault.js'

const SLOTS: KeySlot[] = ['k1', 'k2', 'k3']

/** Le sous-ensemble de GET /relay/:token dont le cœur a besoin. */
export interface RelayLink {
  questions: { id: string }[]
  roles: Record<KeySlot, boolean>
  verify_token: string | null
  shares_enc: Record<KeySlot, string | null>
}

export type RelayAnswer = { ok: false } | { ok: true; shares: Partial<Record<KeySlot, string>> }

export async function answerRelay(link: RelayLink, answers: Answers): Promise<RelayAnswer> {
  if (link.questions.length !== 3) throw new Error('trois questions attendues')
  if (!link.verify_token) throw new Error('verify_token absent du lien')
  const questionIds = link.questions.map((q) => q.id) as QuestionIds
  const contactKey = await deriveContactKey(answers, questionIds)
  try {
    if (!(await checkVerifyToken(contactKey, link.verify_token))) return { ok: false }
    const shares: Partial<Record<KeySlot, string>> = {}
    for (const slot of SLOTS) {
      const enc = link.shares_enc[slot]
      if (!link.roles[slot] || !enc) continue
      const share = await open(contactKey, fromBase64(enc))
      shares[slot] = toBase64(share)
      wipe(share)
    }
    return { ok: true, shares }
  } finally {
    wipe(contactKey)
  }
}

/** Le sous-ensemble de GET /relay/:token/data dont le cœur a besoin. */
export interface RelayData {
  secret_enc: string
  categories: Partial<Record<KeySlot, { category: string; shares: string[]; p2: string | null }>>
}

export interface ReconstructedCategory {
  category: string
  /** Kj recombinée — à effacer dès que le contenu est lu. */
  key: Uint8Array
  /** Le contenu scellé dans P2 (les lignes chiffrées du coffre), ou null si l'owner n'avait rien synchronisé dans cette catégorie. */
  data: Uint8Array | null
}

export async function reconstruct(data: RelayData): Promise<{ categories: Partial<Record<KeySlot, ReconstructedCategory>> }> {
  const categories: Partial<Record<KeySlot, ReconstructedCategory>> = {}
  for (const slot of SLOTS) {
    const cat = data.categories[slot]
    if (!cat) continue
    const shares = cat.shares.map(fromBase64)
    const key = combine(shares)
    wipe(...shares)
    const clear = cat.p2 ? await open(key, fromBase64(cat.p2)) : null
    categories[slot] = { category: cat.category, key, data: clear }
  }
  return { categories }
}

/** secret_enc (nom, rôle, message personnel) est sous K2 : lisible une fois la catégorie messages reconstituée. */
export async function openSecret(k2: Uint8Array, secretEncB64: string): Promise<SecretClear> {
  const clear = await open(k2, fromBase64(secretEncB64))
  try {
    return JSON.parse(Buffer.from(clear).toString('utf8')) as SecretClear
  } finally {
    wipe(clear)
  }
}
