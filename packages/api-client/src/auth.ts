// Méthodes d'authentification (Backend v1.1 §2, DEC-25/27), typées d'après
// les schémas de apps/api/src/api/auth/schemas.ts.

import type { ApiClient } from './client.js'

export type StepUpAction =
  | 'edit_transmission'
  | 'activate_transmission'
  | 'delete_transmission'
  | 'edit_contacts'
  | 'change_password'
  | 'view_seed'
  | 'disable_2fa'
  | 'set_key'
  | 'admin_action'

export interface PublicUser {
  id: string
  email: string
  full_name: string
  language: 'fr' | 'en'
  plan: string
  totp_enabled: boolean
  has_public_key: boolean
  [k: string]: unknown
}

export interface Session {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  user: PublicUser
}

export type LoginResult = Session | { requires_2fa: true; temp_token: string; expires_in: number }

export interface RegisterInput {
  full_name: string
  email: string
  phone: string
  password: string
  language?: 'fr' | 'en'
}

export class AuthApi {
  constructor(private readonly c: ApiClient) {}

  register(input: RegisterInput): Promise<{ pending: true }> {
    return this.c.post('/auth/register', input, { noRefresh: true })
  }

  async verifyEmail(input: { email: string; code: string }): Promise<Session> {
    const s = await this.c.post<Session>('/auth/email/verify', input, { noRefresh: true })
    this.c.accessToken = s.access_token
    return s
  }

  resendOtp(input: { email: string }): Promise<{ sent: true }> {
    return this.c.post('/auth/email/resend-otp', input, { noRefresh: true })
  }

  async login(input: { email: string; password: string }): Promise<LoginResult> {
    const r = await this.c.post<LoginResult>('/auth/login', input, { noRefresh: true })
    if ('access_token' in r) this.c.accessToken = r.access_token
    return r
  }

  /** Second temps du login 2FA : code TOTP ou code de récupération (Point-2). */
  async completeTwoFactor(input: { temp_token: string; code?: string; recovery_code?: string }): Promise<Session> {
    const s = await this.c.post<Session>('/auth/2fa/verify', input, { noRefresh: true })
    this.c.accessToken = s.access_token
    return s
  }

  async logout(): Promise<void> {
    try {
      await this.c.post('/auth/logout', undefined, { noRefresh: true })
    } finally {
      this.c.forgetSession()
    }
  }

  me(): Promise<PublicUser> {
    return this.c.get('/auth/me')
  }

  stepUp(action: StepUpAction): Promise<{ step_up_token: string; action: StepUpAction; exp: number }> {
    return this.c.post('/auth/pin/step-up', { action })
  }

  /** Audit LOW-13 : exige un step-up `set_key` — le PIN vient d'être posé à l'onboarding. */
  registerPublicKey(ed25519_pk: string, stepUpToken: string): Promise<{ registered: true }> {
    return this.c.post('/auth/keys', { ed25519_pk }, { stepUpToken })
  }

  restoreChallenge(): Promise<{ challenge_id: string; challenge: string; expires_at: string }> {
    return this.c.get('/auth/restore/challenge')
  }

  restoreVerify(input: { challenge_id: string; signature: string }): Promise<{ verified: boolean }> {
    return this.c.post('/auth/restore/verify', input)
  }

  changePassword(input: { current_password: string; new_password: string }, stepUpToken: string): Promise<unknown> {
    return this.c.put('/auth/password', input, { stepUpToken })
  }

  twoFactorSetup(): Promise<{ secret: string; otpauth_uri: string }> {
    return this.c.post('/auth/2fa/setup')
  }

  twoFactorActivate(code: string): Promise<{ enabled: true; recovery_codes: string[] }> {
    return this.c.post('/auth/2fa/verify', { code })
  }

  twoFactorDisable(code: string, stepUpToken: string): Promise<{ disabled: true }> {
    return this.c.delete('/auth/2fa', { code }, { stepUpToken })
  }
}
