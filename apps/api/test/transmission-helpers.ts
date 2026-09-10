// Le test joue le rôle de l'app mobile pour tout ce qui est cryptographique :
// sealed box vers la clé de Relais, signatures Ed25519, parts « chiffrées »
// (des octets opaques — le serveur n'en sait rien).

import { createHash } from 'node:crypto'
import sodium from '../src/lib/sodium.js'
import { api, generateDeviceKeys, registerUser, signWith, stepUp, type DeviceKeys } from './helpers.js'

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

export type Roles3 = { k1: boolean; k2: boolean; k3: boolean }
export type Share = { enc: string; sig: string }
export type ContactBodyLike = Awaited<ReturnType<typeof buildContactBody>>

/** Une part Si_enc opaque de 32 bytes + sa signature Ed25519 sur SHA256(Si_enc) (DEC-29). */
export function buildShare(keys: DeviceKeys, seed: number): Share & { bytes: Buffer } {
  const bytes = opaque(seed, 32)
  return { bytes, enc: bytes.toString('base64'), sig: signHash(keys, bytes) }
}

export function buildShares(keys: DeviceKeys, roles: Roles3, seed: number) {
  return {
    k1: roles.k1 ? buildShare(keys, seed * 10 + 1) : null,
    k2: roles.k2 ? buildShare(keys, seed * 10 + 2) : null,
    k3: roles.k3 ? buildShare(keys, seed * 10 + 3) : null,
  }
}

export interface ActivationContact {
  id: string
  body: ContactBodyLike
  seed: number
}

/** Corps de POST /transmission/activate : chaque contact re-signé, une part par rôle, un verify_token. */
export function buildActivationBody(
  keys: DeviceKeys,
  contacts: ActivationContact[],
  opts: { n?: number; m?: number; silence?: number; frequency?: number } = {},
) {
  return {
    silence_duration_months: opts.silence ?? 3,
    checkin_frequency_weeks: opts.frequency ?? 4,
    schema: { n: opts.n ?? 2, m: opts.m ?? contacts.length },
    contacts: contacts.map((c) => {
      const shares = buildShares(keys, c.body.roles, c.seed)
      return {
        id: c.id,
        ...c.body,
        shares: {
          k1: shares.k1 && { enc: shares.k1.enc, sig: shares.k1.sig },
          k2: shares.k2 && { enc: shares.k2.enc, sig: shares.k2.sig },
          k3: shares.k3 && { enc: shares.k3.enc, sig: shares.k3.sig },
        },
        verify_token: opaque(c.seed * 100, 40).toString('base64'),
      }
    }),
  }
}

// --- Mise en place complète, pour les modules qui dépendent d'une transmission active

export type Owner = Awaited<ReturnType<typeof registerUser>> & {
  keys: DeviceKeys
  auth: { Authorization: string }
  relaisPk: string
}

/** Owner avec clé publique enregistrée + clé de Relais récupérée. */
export async function makeOwner(email = 'adjoua@example.cm'): Promise<Owner> {
  const u = await registerUser(email)
  const keys = generateDeviceKeys()
  const auth = { Authorization: `Bearer ${u.accessToken}` }
  await (await api()).post('/auth/keys').set(auth).send({ ed25519_pk: keys.publicKeyBase64 }).expect(200)
  return { ...u, keys, auth, relaisPk: await fetchRelaisKey() }
}

/** N questions secrètes valides (score ≥ 6, actives) prises dans le seed. */
export async function secretQuestionIds(n: number): Promise<string[]> {
  const { prisma } = await import('../src/lib/prisma.js')
  const rows = await prisma().checkin_questions.findMany({
    where: { usage_type: 'secret_question', status: 'active', reliability_score: { gte: 6 } },
    orderBy: { text_fr: 'asc' },
    take: n,
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/** Deux contacts K1 créés puis transmission activée (2-of-2). */
export async function activateTransmission(o: Owner, opts: { silence?: number; frequency?: number } = {}) {
  const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
  const contacts: ActivationContact[] = []
  for (const seed of [1, 2]) {
    const body = await buildContactBody(o.keys, o.relaisPk, {
      notification: { email: `contact${seed}@example.cm`, phone: '+237699000000' },
      roles: { k1: true },
      question_ids: [q1, q2, q3],
      secretSeed: seed,
    })
    const r = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(201)
    contacts.push({ id: r.body.data.id as string, body, seed })
  }
  const su = await stepUp(o.accessToken, 'activate_transmission')
  await (await api())
    .post('/transmission/activate')
    .set(o.auth)
    .set('X-Step-Up-Token', su)
    .send(buildActivationBody(o.keys, contacts, opts))
    .expect(200)
  return contacts
}
