// Écran d'entrée (Frontend §3.2-3.4, DEC-03/04).

export type SessionStatus = 'anonymous' | 'onboarding' | 'authenticated'

export function entryRoute(input: { session: SessionStatus; deviceHasSeed: boolean; keys: 'locked' | 'unlocked' }): string {
  if (input.session === 'onboarding') return '/onboarding/register'
  if (input.session === 'anonymous') return input.deviceHasSeed ? '/login' : '/welcome'
  if (!input.deviceHasSeed) return '/restore'
  return input.keys === 'unlocked' ? '/home' : '/unlock'
}
