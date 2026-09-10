// Le test joue le rôle de l'app mobile pour tout ce qui est cryptographique :
// sealed box vers la clé de Relais, signatures Ed25519, parts « chiffrées »
// (des octets opaques — le serveur n'en sait rien).

import { createHash } from 'node:crypto'
import sodium from '../src/lib/sodium.js'
import { api, signWith, type DeviceKeys } from './helpers.js'

export async function sealToRelais(relaisPkBase64: string, payload: object): Promise<string> {
  await sodium.ready
  const pk = Buffer.from(relaisPkBase64, 'base64')
  const sealed = sodium.crypto_box_seal(Buffer.from(JSON.stringify(payload), 'utf8'), pk)
  return Buffer.from(sealed).toString('base64')
}

export async function fetchRelaisKey(): Promise<string> {
  const r = await (await api()).get('/transmission/relais-key').expect(200)
  return r.body.data.relais_x25519_pk as string
}

/** Un blob « chiffré » déterministe de `size` octets, pour les parts et secret_enc. */
export function opaque(seed: number, size = 64): Buffer {
  const b = Buffer.alloc(size)
  for (let i = 0; i < size; i++) b[i] = (i * 13 + seed * 7 + 3) & 0xff
  return b
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Signature Ed25519 de SHA256(data), comme pour /vault/sync. */
export function signHash(keys: DeviceKeys, data: Buffer): string {
  return signWith(keys, createHash('sha256').update(data).digest())
}

export interface ContactInput {
  notification: { email: string; phone: string }
  roles: { k1?: boolean; k2?: boolean; k3?: boolean }
  question_ids: [string, string, string]
  secretSeed?: number
}

/** Construit le corps de POST /transmission/contacts comme le ferait l'app. */
export async function buildContactBody(keys: DeviceKeys, relaisPk: string, input: ContactInput) {
  const notification_enc = await sealToRelais(relaisPk, input.notification)
  const notificationBytes = Buffer.from(notification_enc, 'base64')
  const secret_enc = opaque(input.secretSeed ?? 1, 96).toString('base64')
  return {
    notification_enc,
    notification_sig: signWith(keys, notificationBytes),
    secret_enc,
    roles: { k1: input.roles.k1 ?? false, k2: input.roles.k2 ?? false, k3: input.roles.k3 ?? false },
    question_ids: input.question_ids,
  }
}
