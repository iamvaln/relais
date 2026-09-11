// Connexion, 2FA, restauration, mot de passe (E1-US05, E6-US01 à US03).
// Des fonctions, pas d'état : l'app tient le KeyStore et le DeviceVault.

import type { ApiClient } from '@relais/api-client'
import { deriveSigningKeypair, fromBase64, mnemonicToSeed, signRaw, toBase64, validateMnemonic, wipe } from '@relais/crypto-core'
import type { DeviceVault } from './device.js'

export class RestoreError extends Error {
  constructor(message = 'Ces 12 mots ne correspondent pas à ce compte') {
    super(message)
    this.name = 'RestoreError'
  }
}

export type LoginOutcome = { status: 'authenticated' } | { status: 'two_factor'; tempToken: string; expiresIn: number }

export async function login(deps: { api: ApiClient }, input: { email: string; password: string }): Promise<LoginOutcome> {
  const r = await deps.api.auth.login(input)
  if ('requires_2fa' in r) return { status: 'two_factor', tempToken: r.temp_token, expiresIn: r.expires_in }
  return { status: 'authenticated' }
}

export async function completeTwoFactor(api: ApiClient, input: { tempToken: string; code?: string; recoveryCode?: string }): Promise<void> {
  await api.auth.completeTwoFactor({
    temp_token: input.tempToken,
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.recoveryCode !== undefined ? { recovery_code: input.recoveryCode } : {}),
  })
}

/**
 * Nouveau device (DEC-04, DEC-06, E6-US01) : les 12 mots donnent le seed, le
 * seed signe le challenge du serveur ; si la clé correspond, le PIN est posé
 * et le seed rendu pour le KeyStore. Le seed ne transite jamais.
 */
export async function restoreWithWords(deps: { api: ApiClient; device: DeviceVault }, input: { words: string; pin: string }): Promise<{ seed: Uint8Array }> {
  if (validateMnemonic(input.words) === null) throw new RestoreError('Phrase de récupération invalide')
  const seed = mnemonicToSeed(input.words)
  const signer = await deriveSigningKeypair(seed)
  try {
    const challenge = await deps.api.auth.restoreChallenge()
    const signature = await signRaw(fromBase64(challenge.challenge), signer.privateKey)
    try {
      await deps.api.auth.restoreVerify({ challenge_id: challenge.challenge_id, signature: toBase64(signature) })
    } catch {
      throw new RestoreError()
    }
    await deps.device.setupPin(seed, input.pin)
    return { seed }
  } catch (err) {
    wipe(seed)
    throw err
  } finally {
    wipe(signer.privateKey)
  }
}

export function requestPasswordReset(api: ApiClient, email: string): Promise<{ pending: true }> {
  return api.post('/auth/password/reset-request', { email })
}

/** Le message signé est celui que le serveur reconstruit : relais:password-reset:v1:{email normalisé}:{code}. */
export function passwordResetMessage(email: string, code: string): Uint8Array {
  return new TextEncoder().encode(`relais:password-reset:v1:${email.trim().toLowerCase()}:${code}`)
}

export async function resetPassword(api: ApiClient, input: { email: string; code: string; words: string; newPassword: string }): Promise<void> {
  if (validateMnemonic(input.words) === null) throw new RestoreError('Phrase de récupération invalide')
  const seed = mnemonicToSeed(input.words)
  const signer = await deriveSigningKeypair(seed)
  wipe(seed)
  try {
    const signature = await signRaw(passwordResetMessage(input.email, input.code), signer.privateKey)
    await api.post('/auth/password/reset', { email: input.email, code: input.code, new_password: input.newPassword, signature: toBase64(signature) }, { noRefresh: true })
  } catch (err) {
    if (err instanceof RestoreError) throw err
    const code = (err as { code?: string }).code
    if (code === 'AUTH_RESTORE_FAILED') throw new RestoreError()
    throw err
  } finally {
    wipe(signer.privateKey)
  }
}

/** E6-US03 : ancien mot de passe + step-up ; le serveur révoque les autres sessions. Rien à rechiffrer (DEC-02). */
export async function changePassword(api: ApiClient, input: { currentPassword: string; newPassword: string }): Promise<{ revoked_sessions: number }> {
  const su = await api.auth.stepUp('change_password')
  return api.put('/auth/password', { current_password: input.currentPassword, new_password: input.newPassword }, { stepUpToken: su.step_up_token })
}

export function setupTotp(api: ApiClient): Promise<{ secret: string; otpauth_uri: string }> {
  return api.auth.twoFactorSetup()
}

/** Rend les 8 codes de récupération — affichés une seule fois (E6-US02, Point-2). */
export async function activateTotp(api: ApiClient, code: string): Promise<string[]> {
  return (await api.auth.twoFactorActivate(code)).recovery_codes
}

export async function disableTotp(api: ApiClient, code: string): Promise<void> {
  const su = await api.auth.stepUp('disable_2fa')
  await api.auth.twoFactorDisable(code, su.step_up_token)
}
