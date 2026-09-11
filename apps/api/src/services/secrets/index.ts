// Secrets de Relais (DEC-15, DEC-18, DEC-30, Backend v1.1 §9.1).
//
// Un seul secret cryptographique côté serveur : relais_x25519_sk, la clé
// X25519 qui ouvre les sealed boxes notification_enc des trusted contacts
// (DEC-28). En production HCV Secrets Engine (KV v2) la fournit — la config
// refuse de démarrer sans ; en dev/test elle vient de RELAIS_X25519_SK_DEV.
// Ce module est le SEUL endroit qui la lit ; le reste du code n'importe que
// les fonctions ci-dessous.

import sodium from '../../lib/sodium.js'
import { env } from '../../config/env.js'
import { sha256Hex } from '../../lib/crypto.js'

export interface RelaisKeypair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface HcvSecretRef {
  addr: string
  token: string
  /** Chemin après /v1/, ex. secret/data/relais/x25519_sk (KV v2). */
  path: string
  field: string
}

/** Lit un champ d'un secret KV v2 : GET {addr}/v1/{path}, X-Vault-Token. Aucun repli : HCV ou rien. */
export async function fetchHcvSecret(ref: HcvSecretRef): Promise<string> {
  const url = `${ref.addr.replace(/\/+$/, '')}/v1/${ref.path.replace(/^\/+/, '')}`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'X-Vault-Token': ref.token, Accept: 'application/json' } })
  } catch (err) {
    throw new Error(`HCV injoignable (${ref.addr})`, { cause: err })
  }
  if (!res.ok) throw new Error(`HCV a répondu ${res.status} pour ${ref.path}`)
  const body = (await res.json()) as { data?: { data?: Record<string, unknown> } }
  const value = body.data?.data?.[ref.field]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`HCV : champ '${ref.field}' absent du secret ${ref.path}`)
  return value
}

/** Sonde /v1/sys/health : 200 (actif), 429 (standby) et 473 (DR/perf standby) comptent comme joignable ; scellé (503) ou injoignable → erreur. */
export async function probeHcv(addr: string): Promise<void> {
  const res = await fetch(`${addr.replace(/\/+$/, '')}/v1/sys/health`, { headers: { Accept: 'application/json' } })
  if (![200, 429, 473].includes(res.status)) throw new Error(`HCV sys/health : ${res.status}`)
}

function decodeKey(raw: string, source: string): Uint8Array {
  const privateKey = new Uint8Array(Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64'))
  if (privateKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new Error(`${source} : ${sodium.crypto_box_SECRETKEYBYTES} bytes attendus, ${privateKey.length} reçus`)
  }
  return privateKey
}

async function loadPrivateKey(): Promise<Uint8Array> {
  const e = env()
  if (e.HCV_ADDR && e.HCV_TOKEN) {
    const raw = await fetchHcvSecret({ addr: e.HCV_ADDR, token: e.HCV_TOKEN, path: e.HCV_SECRET_PATH, field: e.HCV_SECRET_FIELD })
    return decodeKey(raw, `HCV ${e.HCV_SECRET_PATH}`)
  }
  if (!e.RELAIS_X25519_SK_DEV) throw new Error('relais_x25519_sk : ni HCV ni RELAIS_X25519_SK_DEV configurés')
  return decodeKey(e.RELAIS_X25519_SK_DEV, 'RELAIS_X25519_SK_DEV')
}

let cached: Promise<RelaisKeypair> | undefined

export function relaisKeypair(): Promise<RelaisKeypair> {
  cached ??= (async () => {
    await sodium.ready
    const privateKey = await loadPrivateKey()
    return { publicKey: sodium.crypto_scalarmult_base(privateKey), privateKey }
  })().catch((err: unknown) => {
    cached = undefined // une lecture HCV ratée se retente à l'appel suivant
    throw err
  })
  return cached
}

/** Pour les tests : oublier la clé chargée (après un changement d'environnement). */
export function resetSecretsForTests(): void {
  cached = undefined
}

/** Nom de la spec (Backend Specs §9.1, DEC-30). */
export async function getRelaisX25519Sk(): Promise<Uint8Array> {
  return (await relaisKeypair()).privateKey
}

export async function relaisPublicKeyBase64(): Promise<string> {
  return Buffer.from((await relaisKeypair()).publicKey).toString('base64')
}

/**
 * Identifiant de la clé publique en vigueur (DEC-28 « key_version ») : l'app le
 * stocke avec chaque notification_enc pour savoir, en cas de rotation, avec
 * quelle clé la boîte a été scellée.
 */
export async function relaisKeyVersion(): Promise<string> {
  return sha256Hex(Buffer.from((await relaisKeypair()).publicKey)).slice(0, 16)
}
