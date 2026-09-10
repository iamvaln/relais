import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import supertest from 'supertest'
import { buildApp } from '../src/app.js'
import { prisma, disconnectPrisma } from '../src/lib/prisma.js'
import { redis, disconnectRedis } from '../src/lib/redis.js'
import { ConsoleTransport, EmailService, setEmailServiceForTests } from '../src/services/email/index.js'

export const mailbox = new ConsoleTransport(true)
setEmailServiceForTests(new EmailService(mailbox))

let app: FastifyInstance | undefined

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp()
    await app.ready()
  }
  return app
}

export async function api() {
  const a = await getApp()
  return supertest(a.server)
}

export async function closeAll(): Promise<void> {
  await app?.close()
  app = undefined
  await disconnectPrisma()
  await disconnectRedis()
}

/** Vide les tables mutables — la bibliothèque de questions et app_config restent. */
export async function resetState(): Promise<void> {
  await prisma().$executeRawUnsafe(`
    TRUNCATE email_log, restore_challenges, email_otp, sessions, subscriptions, users
    RESTART IDENTITY CASCADE
  `)
  await redis().flushall()
  mailbox.clear()
}

/** Extrait le code à 6 chiffres du dernier email envoyé. */
export function lastOtp(): string {
  const last = mailbox.last()
  if (!last) throw new Error('aucun email envoyé')
  const m = /\b(\d{6})\b/.exec(last.text)
  if (!m) throw new Error(`pas de code dans : ${last.text}`)
  return m[1]!
}

export function lastEmailTo(to: string) {
  return [...mailbox.sent].reverse().find((e) => e.to === to)
}

export const STRONG_PASSWORD = 'Correct-Horse-9!'

export function refreshCookie(res: supertest.Response): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | undefined
  return raw?.find((c) => c.startsWith('refresh_token='))
}

export function cookieValue(setCookie: string): string {
  return setCookie.split(';')[0]!
}

/** Inscription complète : register → OTP → verify. Retourne le token et le cookie. */
export async function registerUser(email: string, opts: { password?: string; name?: string } = {}) {
  const client = await api()
  const password = opts.password ?? STRONG_PASSWORD
  await client
    .post('/auth/register')
    .send({ full_name: opts.name ?? 'Adjoua Ngo', email, phone: '+237690000000', password })
    .expect(200)
  const code = lastOtp()
  const res = await client.post('/auth/email/verify').send({ email, code }).expect(200)
  return {
    email,
    password,
    accessToken: res.body.data.access_token as string,
    userId: res.body.data.user.id as string,
    cookie: refreshCookie(res)!,
  }
}

export async function stepUp(accessToken: string, action: string): Promise<string> {
  const client = await api()
  const res = await client
    .post('/auth/pin/step-up')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ action })
    .expect(200)
  return res.body.data.step_up_token as string
}

// --- Ed25519 côté "device" : le test joue le rôle de l'app mobile -------------

export interface DeviceKeys {
  privateKey: KeyObject
  publicKeyRaw: Buffer
  publicKeyBase64: string
}

export function generateDeviceKeys(): DeviceKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  // SPKI DER = 12 bytes de préfixe + 32 bytes de clé brute
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const publicKeyRaw = spki.subarray(spki.length - 32)
  return { privateKey, publicKeyRaw, publicKeyBase64: publicKeyRaw.toString('base64') }
}

export function signWith(keys: DeviceKeys, message: Buffer): string {
  return sign(null, message, keys.privateKey).toString('base64')
}
