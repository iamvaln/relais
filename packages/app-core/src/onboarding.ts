// Onboarding de l'owner (E1-US01 à US03, Flowchart F1/T1, Frontend §3.1) :
//
//   account → otp → words → quiz → pin → biometrics → done
//
// Les 12 mots ne vivent que dans cet objet, le temps de l'affichage et du
// quiz ; finish() les efface. Le seed est dérivé au moment du PIN et rendu à
// l'app pour le KeyStore (qui l'efface après dérivation des clés). La clé
// publique Ed25519 part au serveur à ce moment-là (DEC-05).

import type { ApiClient, RegisterInput } from '@relais/api-client'
import { deriveSigningKeypair, generateMnemonic, mnemonicToSeed, normalizeMnemonic, toBase64, wipe } from '@relais/crypto-core'
import type { DeviceVault } from './device.js'

export type OnboardingStep = 'account' | 'otp' | 'words' | 'quiz' | 'pin' | 'biometrics' | 'done'

export interface OnboardingState {
  step: OnboardingStep
  email?: string
  words?: string
  quiz?: [number, number]
}

export interface OnboardingDeps {
  api: ApiClient
  device: DeviceVault
  language: 'fr' | 'en'
  /** Source d'aléa pour le quiz (tests) ; Math.random par défaut. */
  random?: () => number
}

const WORD_COUNT = 12

export class Onboarding {
  state: OnboardingState = { step: 'account' }
  private readonly random: () => number

  constructor(private readonly deps: OnboardingDeps) {
    this.random = deps.random ?? Math.random
  }

  private expect(step: OnboardingStep): void {
    if (this.state.step !== step) throw new Error(`étape ${this.state.step}, attendu ${step}`)
  }

  async submitAccount(input: RegisterInput): Promise<void> {
    this.expect('account')
    await this.deps.api.auth.register({ ...input, language: input.language ?? this.deps.language })
    this.state = { step: 'otp', email: input.email }
  }

  async resendOtp(): Promise<void> {
    this.expect('otp')
    await this.deps.api.auth.resendOtp({ email: this.state.email! })
  }

  /** Le compte existe après l'OTP ; les 12 mots sont générés ici, jamais envoyés (E1-US02). */
  async submitOtp(code: string): Promise<void> {
    this.expect('otp')
    await this.deps.api.auth.verifyEmail({ email: this.state.email!, code })
    this.state = { ...this.state, step: 'words', words: generateMnemonic(this.deps.language) }
  }

  /** « J'ai bien noté mes 12 mots » : deux mots tirés au sort à ressaisir (décision du 11/09/2026). */
  confirmWordsNoted(): [number, number] {
    this.expect('words')
    const first = Math.floor(this.random() * WORD_COUNT) % WORD_COUNT
    let second = Math.floor(this.random() * (WORD_COUNT - 1)) % (WORD_COUNT - 1)
    if (second >= first) second += 1
    const quiz: [number, number] = first < second ? [first, second] : [second, first]
    this.state = { ...this.state, step: 'quiz', quiz }
    return quiz
  }

  checkQuiz(answers: [string, string]): boolean {
    this.expect('quiz')
    const words = this.state.words!.split(' ')
    const [a, b] = this.state.quiz!
    const ok = normalizeMnemonic(answers[0]) === words[a] && normalizeMnemonic(answers[1]) === words[b]
    if (ok) this.state = { ...this.state, step: 'pin' }
    return ok
  }

  /** PIN posé, clé publique enregistrée ; rend le seed pour le KeyStore et, éventuellement, la biométrie. */
  async submitPin(pin: string): Promise<{ seed: Uint8Array }> {
    this.expect('pin')
    const seed = mnemonicToSeed(this.state.words!)
    await this.deps.device.setupPin(seed, pin)
    const signer = await deriveSigningKeypair(seed)
    try {
      await this.deps.api.auth.registerPublicKey(toBase64(signer.publicKey))
    } finally {
      wipe(signer.privateKey)
    }
    this.state = { ...this.state, step: 'biometrics' }
    return { seed }
  }

  async enableBiometrics(seed: Uint8Array): Promise<void> {
    this.expect('biometrics')
    await this.deps.device.enableBiometrics(seed)
  }

  finish(): void {
    this.expect('biometrics')
    this.state = { step: 'done' }
  }
}
