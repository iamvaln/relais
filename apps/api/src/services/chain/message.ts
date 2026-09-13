// Le message que l'owner signe pour la chaîne (docs/smart-contract-v2.md D1,
// §9) — recomposé ici exactement comme `crypto-core` (chain.ts) le produit :
//
//   subject = 0x + keccak256(ed25519_pk)
//   message = SHA256("relais:dms:v2|action|subject|nextDue|pausedUntil|n|m|silenceSecs|checkinFreqSecs")
//   sig     = Ed25519(message), 64 octets
//
// Champs absents à 0, dates en secondes Unix alignées au jour, sujet en minuscules.

import { createHash } from 'node:crypto'
import { keccak256, type Hex } from 'viem'
import { ed25519Verify } from '../../lib/crypto.js'

export const CHAIN_MESSAGE_PREFIX = 'relais:dms:v2'
export const DAY_S = 86_400
/** Écart toléré entre la date signée par l'app et celle calculée par l'API (horloges, latence). */
export const DATE_TOLERANCE_S = 2 * DAY_S

export type ChainAction = 'register' | 'checkin' | 'pause' | 'resume' | 'cancelTrigger' | 'deactivate'
export const CHAIN_ACTIONS: readonly ChainAction[] = ['register', 'checkin', 'pause', 'resume', 'cancelTrigger', 'deactivate']

export interface ChainFields {
  nextDue?: number
  pausedUntil?: number
  n?: number
  m?: number
  silenceSecs?: number
  checkinFreqSecs?: number
}

export function chainSubjectOf(ed25519Pk: Buffer): Hex {
  if (ed25519Pk.length !== 32) throw new Error('clé publique Ed25519 : 32 octets attendus')
  return keccak256(ed25519Pk)
}

export function isDayAligned(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= 0 && seconds % DAY_S === 0
}

/** Le premier minuit UTC strictement après `date`, en secondes Unix. */
export function ceilDaySeconds(date: Date): number {
  return (Math.floor(date.getTime() / 1000 / DAY_S) + 1) * DAY_S
}

export function chainMessageText(action: ChainAction, subject: string, f: ChainFields = {}): string {
  return [CHAIN_MESSAGE_PREFIX, action, subject.toLowerCase(), f.nextDue ?? 0, f.pausedUntil ?? 0, f.n ?? 0, f.m ?? 0, f.silenceSecs ?? 0, f.checkinFreqSecs ?? 0].join('|')
}

export function chainMessage(action: ChainAction, subject: string, f: ChainFields = {}): Buffer {
  return createHash('sha256').update(chainMessageText(action, subject, f), 'utf8').digest()
}

export function verifyOwnerChainSig(ed25519Pk: Buffer, signature: Buffer, action: ChainAction, subject: string, f: ChainFields = {}): boolean {
  return ed25519Verify(ed25519Pk, chainMessage(action, subject, f), signature)
}
