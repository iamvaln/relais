// Carnet de vie et Wrapped (DEC-31/32, Techniques §6, Frontend §6).
//   content_enc = seal(K2, JSON { question_id, entry_month, mode, texte })
//   signature   = Ed25519.sign(SHA256(content_enc))
//   DELETE      : signature = Ed25519.sign(SHA256(id en UTF-8))  — tel que l'API le vérifie
//   Wrapped     : stats_enc = seal(K2, stats), signature = sign(SHA256(stats_enc))

import { seal } from './aead.js'
import { signPayload, wipe } from './keys.js'
import { toBase64 } from './vault.js'

export type JournalMode = 'essential' | 'reflective' | 'free'

export interface EntryClear {
  question_id: string | null
  entry_month: string
  mode: JournalMode
  texte: string
}

export interface EntryPayload {
  content_enc: string
  signature: string
  entry_month: string
  mode: JournalMode
  question_id?: string
  word_count_approx?: number
}

export async function buildEntryPayload(k2: Uint8Array, clear: EntryClear, signingKey: Uint8Array, opts: { word_count_approx?: number } = {}): Promise<EntryPayload> {
  const payload = new TextEncoder().encode(JSON.stringify(clear))
  const enc = await seal(k2, payload)
  wipe(payload)
  return {
    content_enc: toBase64(enc),
    signature: toBase64(await signPayload(enc, signingKey)),
    entry_month: clear.entry_month,
    mode: clear.mode,
    ...(clear.question_id ? { question_id: clear.question_id } : {}),
    ...(opts.word_count_approx !== undefined ? { word_count_approx: opts.word_count_approx } : {}),
  }
}

export async function buildDeleteSignature(entryId: string, signingKey: Uint8Array): Promise<{ signature: string }> {
  return { signature: toBase64(await signPayload(new TextEncoder().encode(entryId), signingKey)) }
}

export async function buildWrappedPayload(k2: Uint8Array, stats: unknown, signingKey: Uint8Array): Promise<{ stats_enc: string; signature: string }> {
  const payload = new TextEncoder().encode(JSON.stringify(stats))
  const enc = await seal(k2, payload)
  wipe(payload)
  return { stats_enc: toBase64(enc), signature: toBase64(await signPayload(enc, signingKey)) }
}
