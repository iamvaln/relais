// Contacts de confiance, côté owner (Techniques §1, §4, §5.3 ; DEC-12/13/20/28/29 ;
// Proposal-8). Produit exactement ce que POST /transmission/contacts et
// POST /transmission/activate attendent ; ne garde rien.
//
//   K_i = Argon2id(réponses normalisées jointes par '|', sel, MODERATE)
//         sel = SHA256('relais_contact_v1|q1|q2|q3')[0:16] — public, stable,
//         propre au contact, dérivable par le contact depuis GET /relay/:token
//         (décision du 11/09/2026 : pas de colonne kdf_salt)
//   verify_token     = seal(K_i, 'RELAIS_VERIFY_OK_V1')  — vérification annuelle et locale des réponses
//   notification_enc = crypto_box_seal(JSON { email, phone, owner_display_name? }, relais_x25519_pk)
//   notification_sig = Ed25519.sign(notification_enc)  — brut (Backend §4.3 étape 2)
//   secret_enc       = seal(K2, JSON { nom, role, message_personnel })  — Relais ne lit jamais
//   part Si (33 octets) : enc = seal(K_i, Si), sig = sign(SHA256(enc)) [DEC-29],
//                         plain_hash = hex SHA256(Si), plain_sig = sign(SHA256(Si)) [Proposal-8]

import { open, seal } from './aead.js'
import { argon2id, sha256, signPayload, signRaw, wipe } from './keys.js'
import sodium from './sodium.js'
import { fromBase64, toBase64 } from './vault.js'

export type QuestionIds = [string, string, string]
export type Answers = [string, string, string]

const CONTACT_CONTEXT = 'relais_contact_v1'
const VERIFY_MARKER = new TextEncoder().encode('RELAIS_VERIFY_OK_V1')
const utf8 = (s: string) => new TextEncoder().encode(s)

/** Même règle que normalizeAnswer du check-in : les réponses doivent redonner la même clé des années plus tard. */
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function contactSalt(questionIds: QuestionIds): Uint8Array {
  return sha256(utf8(`${CONTACT_CONTEXT}|${questionIds.join('|')}`)).slice(0, sodium.crypto_pwhash_SALTBYTES)
}

export async function deriveContactKey(answers: Answers, questionIds: QuestionIds): Promise<Uint8Array> {
  await sodium.ready
  const material = utf8(answers.map(normalizeAnswer).join('|'))
  try {
    return await argon2id(material, contactSalt(questionIds), 'moderate')
  } finally {
    wipe(material)
  }
}

export async function buildVerifyToken(contactKey: Uint8Array): Promise<string> {
  return toBase64(await seal(contactKey, VERIFY_MARKER))
}

export async function checkVerifyToken(contactKey: Uint8Array, verifyTokenB64: string): Promise<boolean> {
  try {
    const marker = await open(contactKey, fromBase64(verifyTokenB64))
    return marker.length === VERIFY_MARKER.length && marker.every((b, i) => b === VERIFY_MARKER[i])
  } catch {
    return false
  }
}

export interface NotificationClear {
  email: string
  phone: string | null
  owner_display_name?: string
}

export interface SealedNotification {
  notification_enc: string
  notification_sig: string
}

export async function sealNotification(relaisPkB64: string, clear: NotificationClear, signingKey: Uint8Array): Promise<SealedNotification> {
  await sodium.ready
  const pk = fromBase64(relaisPkB64)
  if (pk.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('clé publique de Relais : 32 octets attendus')
  const payload = utf8(JSON.stringify(clear))
  const enc = sodium.crypto_box_seal(payload, pk)
  wipe(payload)
  return { notification_enc: toBase64(enc), notification_sig: toBase64(await signRaw(enc, signingKey)) }
}

export interface SecretClear {
  nom: string
  role: string
  message_personnel: string
}

export async function encryptSecret(k2: Uint8Array, clear: SecretClear): Promise<string> {
  const payload = utf8(JSON.stringify(clear))
  try {
    return toBase64(await seal(k2, payload))
  } finally {
    wipe(payload)
  }
}

export interface PreparedShare {
  enc: string
  sig: string
  plain_hash: string
  plain_sig: string
}

export async function prepareShare(share: Uint8Array, contactKey: Uint8Array, signingKey: Uint8Array): Promise<PreparedShare> {
  const enc = await seal(contactKey, share)
  return {
    enc: toBase64(enc),
    sig: toBase64(await signPayload(enc, signingKey)),
    plain_hash: Buffer.from(sha256(share)).toString('hex'),
    plain_sig: toBase64(await signPayload(share, signingKey)),
  }
}
