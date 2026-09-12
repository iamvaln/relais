// Audit MEDIUM-9 : les tables transitoires (OTP, challenges de restauration,
// sessions) gardent des lignes expirées pour toujours ; l'OTP porte l'email
// en clair. Un job horaire les purge.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { purgeExpired } from '../src/jobs/maintenance.js'
import { prisma } from '../src/lib/prisma.js'
import { closeAll, registerUser, resetState } from './helpers.js'

beforeEach(resetState)
afterAll(closeAll)

// L'horloge du job est l'heure réelle : les lignes créées par registerUser (OTP consommé, session vivante) n'expirent pas pendant le test.
const NOW = new Date()
const past = new Date(NOW.getTime() - 60_000)
const future = new Date(NOW.getTime() + 60_000)

describe('purgeExpired', () => {
  it('supprime OTP, challenges et sessions expirés, garde les autres, et compte', async () => {
    const u = await registerUser('adjoua@example.cm')
    await prisma().email_otp.createMany({
      data: [
        { user_id: null, email: 'x@example.cm', otp_hash: 'a'.repeat(64), purpose: 'registration', expires_at: past },
        { user_id: u.userId, email: u.email, otp_hash: 'b'.repeat(64), purpose: 'password_reset', expires_at: future },
      ],
    })
    await prisma().restore_challenges.createMany({
      data: [
        { user_id: u.userId, challenge: Buffer.alloc(32, 1), expires_at: past },
        { user_id: u.userId, challenge: Buffer.alloc(32, 2), expires_at: future },
      ],
    })
    await prisma().sessions.create({ data: { user_id: u.userId, refresh_token_hash: 'c'.repeat(64), expires_at: past } })
    const live = await prisma().sessions.count({ where: { expires_at: { gt: NOW } } })

    expect(await purgeExpired(NOW)).toEqual({ otps: 1, challenges: 1, sessions: 1 })
    // L'OTP expiré est parti ; celui à venir et l'OTP d'inscription (consommé, pas expiré) restent
    expect(await prisma().email_otp.count({ where: { otp_hash: 'a'.repeat(64) } })).toBe(0)
    expect(await prisma().email_otp.count({ where: { otp_hash: 'b'.repeat(64) } })).toBe(1)
    expect(await prisma().email_otp.count({ where: { expires_at: { lt: NOW } } })).toBe(0)
    expect(await prisma().restore_challenges.count()).toBe(1)
    expect(await prisma().sessions.count()).toBe(live)
    expect(await purgeExpired(NOW)).toEqual({ otps: 0, challenges: 0, sessions: 0 })
  })
})
