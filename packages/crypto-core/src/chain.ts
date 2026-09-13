// Contrat Arbitrum v2 (docs/smart-contract-v2.md §1 D1, §9) — ce que le device
// produit pour la chaîne, sans réseau ni wallet :
//
//   subject = keccak256(ed25519_pk)                           — pseudonyme on-chain
//   message = SHA256("relais:dms:v2|" ‖ action ‖ subject ‖ nextDue ‖ pausedUntil
//                    ‖ n ‖ m ‖ silenceSecs ‖ checkinFreqSecs)  — champs absents à 0
//   ownerSig = Ed25519(message)                              — 64 octets, publiée dans l'événement
//
// L'opérateur (l'API) vérifie la signature avec ed25519_pk avant de relayer, et
// quiconque peut la revérifier depuis les logs. Les dates sont en secondes Unix,
// alignées au jour : le contrat refuse tout le reste.

import { keccak_256 } from '@noble/hashes/sha3.js'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { signRaw, verifyRaw } from './keys.js'

export const CHAIN_MESSAGE_PREFIX = 'relais:dms:v2'
export const CHAIN_DAY_SECONDS = 86_400

export type ChainAction = 'register' | 'checkin' | 'pause' | 'resume' | 'cancelTrigger' | 'deactivate'

export interface ChainFields {
  /** Échéance de check-in, secondes Unix alignées au jour. */
  nextDue?: number
  /** Fin de pause, secondes Unix alignées au jour. */
  pausedUntil?: number
  n?: number
  m?: number
  silenceSecs?: number
  checkinFreqSecs?: number
}

/** `0x` + keccak256(pk) : l'identité on-chain, liée à la clé et à rien d'autre (DEC-05, DEC-11). */
export function chainSubject(ed25519Pk: Uint8Array): `0x${string}` {
  if (ed25519Pk.length !== 32) throw new Error('clé publique Ed25519 : 32 octets attendus')
  return `0x${bytesToHex(keccak_256(ed25519Pk))}`
}

function dayAligned(name: string, value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} : entier positif attendu`)
  if (value % CHAIN_DAY_SECONDS !== 0) throw new Error(`${name} : la date doit être alignée au jour`)
  return value
}

function count(name: string, value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} : entier positif attendu`)
  return value
}

/** Le texte canonique, avant hachage — exposé pour que l'API et les tests le recomposent. */
export function chainMessageText(action: ChainAction, subject: string, fields: ChainFields = {}): string {
  return [
    CHAIN_MESSAGE_PREFIX,
    action,
    subject.toLowerCase(),
    dayAligned('nextDue', fields.nextDue),
    dayAligned('pausedUntil', fields.pausedUntil),
    count('n', fields.n),
    count('m', fields.m),
    count('silenceSecs', fields.silenceSecs),
    count('checkinFreqSecs', fields.checkinFreqSecs),
  ].join('|')
}

/** SHA256 du message canonique : ce que l'owner signe. */
export function chainMessage(action: ChainAction, subject: string, fields: ChainFields = {}): Uint8Array {
  return nobleSha256(new TextEncoder().encode(chainMessageText(action, subject, fields)))
}

export async function signChainAction(privateKey: Uint8Array, action: ChainAction, subject: string, fields: ChainFields = {}): Promise<Uint8Array> {
  return signRaw(chainMessage(action, subject, fields), privateKey)
}

export async function verifyChainAction(publicKey: Uint8Array, signature: Uint8Array, action: ChainAction, subject: string, fields: ChainFields = {}): Promise<boolean> {
  if (signature.length !== 64) return false
  return verifyRaw(chainMessage(action, subject, fields), signature, publicKey)
}
