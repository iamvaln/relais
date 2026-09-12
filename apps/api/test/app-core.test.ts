// @relais/app-core contre la vraie API : onboarding (E1-US01 à US03),
// connexion et 2FA (E1-US05, E6-US02), restauration sur nouveau device
// (E6-US01), mot de passe oublié et changement (E1-US05, E6-US03).
// Le device est une MemorySecureStorage ; l'API écoute sur un port éphémère.

import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiClient, MemoryCookieJar } from '@relais/api-client'
import {
  DeviceVault,
  MemorySecureStorage,
  Onboarding,
  PinGuard,
  RestoreError,
  WeakPinError,
  activateTotp,
  changePassword,
  completeTwoFactor,
  disableTotp,
  login,
  requestPasswordReset,
  resetPassword,
  restoreWithWords,
  setupTotp,
} from '@relais/app-core'
import { deriveSigningKeypair, mnemonicToSeed, toBase64, validateMnemonic } from '@relais/crypto-core'
import { prisma } from '../src/lib/prisma.js'
import { closeAll, forgetTotpSteps, getApp, lastEmailTo, lastOtp, mailbox, resetState, STRONG_PASSWORD } from './helpers.js'

let baseUrl = ''
beforeAll(async () => {
  baseUrl = await (await getApp()).listen({ port: 0, host: '127.0.0.1' })
})
beforeEach(resetState)
afterAll(closeAll)

const EMAIL = 'adjoua@example.cm'
const ACCOUNT = { full_name: 'Adjoua Ngo', email: EMAIL, phone: '+237699000000', password: STRONG_PASSWORD, language: 'fr' as const }

function newDevice() {
  const storage = new MemorySecureStorage()
  const api = new ApiClient({ baseUrl, cookieJar: new MemoryCookieJar(), language: 'fr' })
  const device = new DeviceVault(storage, new PinGuard(storage))
  return { storage, api, device }
}

/** Parcours complet d'inscription ; rend le device prêt et les 12 mots (pour les scénarios suivants). */
async function onboard(pin = '482913') {
  const d = newDevice()
  const flow = new Onboarding({ api: d.api, device: d.device, language: 'fr', random: () => 0.5 })
  await flow.submitAccount(ACCOUNT)
  await flow.submitOtp(lastOtp())
  const words = flow.state.words!
  const quiz = flow.confirmWordsNoted()
  const w = words.split(' ')
  expect(flow.checkQuiz([w[quiz[0]]!, w[quiz[1]]!])).toBe(true)
  const { seed } = await flow.submitPin(pin)
  flow.finish()
  return { ...d, words, seed }
}

describe('onboarding', () => {
  it('compte → OTP → 12 mots → quiz → PIN → clé publique → biométrie ; les mots ne restent nulle part', async () => {
    const { api, device } = newDevice()
    const flow = new Onboarding({ api, device, language: 'fr', random: () => 0.5 })
    expect(flow.state.step).toBe('account')
    await flow.submitAccount(ACCOUNT)
    expect(flow.state.step).toBe('otp')
    expect(api.accessToken).toBeNull()

    await flow.submitOtp(lastOtp())
    expect(flow.state.step).toBe('words')
    expect(api.accessToken).toBeTruthy()
    const words = flow.state.words!
    expect(validateMnemonic(words)).toBe('fr')

    const quiz = flow.confirmWordsNoted()
    expect(flow.state.step).toBe('quiz')
    expect(quiz[0]).not.toBe(quiz[1])
    expect(quiz.every((i) => i >= 0 && i < 12)).toBe(true)
    expect(flow.checkQuiz(['faux', 'faux'])).toBe(false)
    expect(flow.state.step).toBe('quiz')
    const w = words.split(' ')
    expect(flow.checkQuiz([w[quiz[0]]!.toUpperCase(), ` ${w[quiz[1]]!} `])).toBe(true)
    expect(flow.state.step).toBe('pin')

    await expect(flow.submitPin('123456')).rejects.toThrow(WeakPinError)
    const { seed } = await flow.submitPin('482913')
    expect(seed).toHaveLength(64)
    expect(flow.state.step).toBe('biometrics')
    expect(await device.hasSeed()).toBe(true)
    const me = await api.auth.me()
    expect(me.has_public_key).toBe(true)
    const expectedPk = toBase64((await deriveSigningKeypair(mnemonicToSeed(words))).publicKey)
    const row = await prisma().users.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(Buffer.from(row.ed25519_pk!).toString('base64')).toBe(expectedPk)

    await flow.enableBiometrics(seed)
    expect(await device.hasBiometrics()).toBe(true)
    flow.finish()
    expect(flow.state.step).toBe('done')
    expect(flow.state.words).toBeUndefined()
    expect(Buffer.from(await device.unlockWithPin('482913'))).toEqual(Buffer.from(mnemonicToSeed(words)))
  })
})

describe('connexion et restauration', () => {
  it('nouveau device : login puis restauration avec les 12 mots (mauvais mots refusés), email de notification, PIN posé', async () => {
    const { words } = await onboard()
    const other = newDevice()
    expect(await other.device.hasSeed()).toBe(false)
    const r = await login({ api: other.api }, { email: EMAIL, password: STRONG_PASSWORD })
    expect(r).toEqual({ status: 'authenticated' })

    const wrong = words.split(' ').reverse().join(' ')
    await expect(restoreWithWords({ api: other.api, device: other.device }, { words: wrong, pin: '482913' })).rejects.toThrow(RestoreError)
    await expect(restoreWithWords({ api: other.api, device: other.device }, { words: 'pas une phrase', pin: '482913' })).rejects.toThrow(RestoreError)
    mailbox.clear()
    const { seed } = await restoreWithWords({ api: other.api, device: other.device }, { words: `  ${words.toUpperCase()} `, pin: '907315' })
    expect(Buffer.from(seed)).toEqual(Buffer.from(mnemonicToSeed(words)))
    expect(await other.device.hasSeed()).toBe(true)
    expect(lastEmailTo(EMAIL)?.subject).toMatch(/restaur/i)
  })

  it('mot de passe oublié : OTP + 12 mots signent la réinitialisation ; changement avec step-up révoque les autres sessions', async () => {
    const { api, words } = await onboard()
    const other = newDevice()
    await requestPasswordReset(other.api, EMAIL)
    const code = lastOtp()
    await expect(resetPassword(other.api, { email: EMAIL, code, words: words.split(' ').reverse().join(' '), newPassword: 'Nouveau-Mot-2!' })).rejects.toThrow(RestoreError)
    await resetPassword(other.api, { email: EMAIL, code, words, newPassword: 'Nouveau-Mot-2!' })
    expect(await login({ api: other.api }, { email: EMAIL, password: 'Nouveau-Mot-2!' })).toEqual({ status: 'authenticated' })

    await changePassword(other.api, { currentPassword: 'Nouveau-Mot-2!', newPassword: 'Encore-Un-3!' })
    await expect(api.auth.me()).rejects.toMatchObject({ status: 401 })
    expect(await login({ api: newDevice().api }, { email: EMAIL, password: 'Encore-Un-3!' })).toEqual({ status: 'authenticated' })
  })

  it('TOTP : activation avec QR et 8 codes de récupération, login en deux temps par TOTP puis par code de secours, désactivation', async () => {
    const { api } = await onboard()
    const setup = await setupTotp(api)
    expect(setup.otpauth_uri).toMatch(/^otpauth:\/\/totp\//)
    const totp = new OTPAuth.TOTP({ secret: setup.secret, digits: 6, period: 30 })
    const codes = await activateTotp(api, totp.generate())
    await forgetTotpSteps() // audit LOW-14a : le code d'activation est brûlé ; le test enchaîne dans la même demi-minute
    expect(codes).toHaveLength(8)

    const d2 = newDevice()
    const first = await login({ api: d2.api }, { email: EMAIL, password: STRONG_PASSWORD })
    expect(first.status).toBe('two_factor')
    if (first.status !== 'two_factor') throw new Error('unreachable')
    await completeTwoFactor(d2.api, { tempToken: first.tempToken, code: totp.generate() })
    expect((await d2.api.auth.me()).email).toBe(EMAIL)

    const d3 = newDevice()
    const second = await login({ api: d3.api }, { email: EMAIL, password: STRONG_PASSWORD })
    if (second.status !== 'two_factor') throw new Error('unreachable')
    await completeTwoFactor(d3.api, { tempToken: second.tempToken, recoveryCode: codes[0]! })
    expect((await d3.api.auth.me()).totp_enabled).toBe(true)

    await forgetTotpSteps() // le code du login est brûlé
    await disableTotp(api, totp.generate())
    expect(await login({ api: newDevice().api }, { email: EMAIL, password: STRONG_PASSWORD })).toEqual({ status: 'authenticated' })
  })
})
