// Ce que l'app signe pour la chaîne (docs/smart-contract-v2.md §4, lot 3a) : le
// champ `chain` des actions qui engagent le minuteur. Sujet absent → c'est un
// enregistrement ; dates alignées au jour supérieur ; signature Ed25519 du seed.

import { describe, expect, it } from 'vitest'
import { chainSubject, deriveSigningKeypair, mnemonicToSeed, verifyChainAction } from '@relais/crypto-core'
import { chainFieldFor, nextDueFor, pausedUntilFor } from '../src/chain.js'

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const DAY = 86_400
const NOW = new Date('2026-09-13T07:30:00Z')
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

async function signer() {
  const kp = await deriveSigningKeypair(mnemonicToSeed(VECTOR))
  return { kp, subject: chainSubject(kp.publicKey) }
}

describe('dates', () => {
  it('nextDueFor : maintenant + fréquence, arrondi au jour supérieur ; pausedUntilFor : maintenant + jours, idem', () => {
    const due = nextDueFor(NOW, 4)
    expect(due % DAY).toBe(0)
    expect(due).toBe(Math.floor(new Date('2026-10-12T00:00:00Z').getTime() / 1000)) // 11/10 07:30 → minuit suivant
    expect(pausedUntilFor(NOW, 30)).toBe(Math.floor(new Date('2026-10-14T00:00:00Z').getTime() / 1000))
  })

  it('nextDueFor dépasse strictement l’échéance courante : reprise ou check-in le jour même → un jour de plus', () => {
    const same = new Date('2026-10-11T09:00:00Z').toISOString() // même jour que maintenant + 4 semaines
    expect(nextDueFor(NOW, 4, same)).toBe(nextDueFor(NOW, 4) + DAY)
    const older = new Date('2026-09-20T00:00:00Z').toISOString()
    expect(nextDueFor(NOW, 4, older)).toBe(nextDueFor(NOW, 4))
    expect(nextDueFor(NOW, 4, null)).toBe(nextDueFor(NOW, 4))
    expect(nextDueFor(NOW, 4, 'pas une date')).toBe(nextDueFor(NOW, 4))
  })
})

describe('chainFieldFor', () => {
  it('sans sujet on-chain : un `register` signé avec n, m (contacts porteurs), silence et fréquence', async () => {
    const { kp, subject } = await signer()
    const f = await chainFieldFor(kp, null, 'checkin', { now: NOW, checkinFrequencyWeeks: 4, register: { n: 2, m: 3, silenceMonths: 3 } })
    expect(f).toEqual({ action: 'register', next_due: nextDueFor(NOW, 4), sig: expect.any(String) })
    expect(await verifyChainAction(kp.publicKey, b64(f.sig), 'register', subject, { nextDue: f.next_due, n: 2, m: 3, silenceSecs: 90 * DAY, checkinFreqSecs: 28 * DAY })).toBe(true)
  })

  it('register explicite (activation) : même champ, sujet présent ou non', async () => {
    const { kp, subject } = await signer()
    const f = await chainFieldFor(kp, subject, 'register', { now: NOW, checkinFrequencyWeeks: 4, register: { n: 2, m: 2, silenceMonths: 1 } })
    expect(f.action).toBe('register')
    expect(await verifyChainAction(kp.publicKey, b64(f.sig), 'register', subject, { nextDue: f.next_due, n: 2, m: 2, silenceSecs: 30 * DAY, checkinFreqSecs: 28 * DAY })).toBe(true)
  })

  it('avec un sujet : l’action de l’endpoint (checkin, resume, cancelTrigger) portant next_due', async () => {
    const { kp, subject } = await signer()
    for (const action of ['checkin', 'resume', 'cancelTrigger'] as const) {
      const f = await chainFieldFor(kp, subject, action, { now: NOW, checkinFrequencyWeeks: 2 })
      expect(f).toEqual({ next_due: nextDueFor(NOW, 2), sig: expect.any(String) })
      expect(await verifyChainAction(kp.publicKey, b64(f.sig), action, subject, { nextDue: f.next_due })).toBe(true)
      expect(await verifyChainAction(kp.publicKey, b64(f.sig), 'deactivate', subject, { nextDue: f.next_due })).toBe(false)
    }
  })

  it('pause : paused_until ; deactivate : la signature seule', async () => {
    const { kp, subject } = await signer()
    const p = await chainFieldFor(kp, subject, 'pause', { now: NOW, checkinFrequencyWeeks: 4, pauseDays: 7 })
    expect(p).toEqual({ paused_until: pausedUntilFor(NOW, 7), sig: expect.any(String) })
    expect(await verifyChainAction(kp.publicKey, b64(p.sig), 'pause', subject, { pausedUntil: p.paused_until })).toBe(true)
    const d = await chainFieldFor(kp, subject, 'deactivate', { now: NOW, checkinFrequencyWeeks: 4 })
    expect(d).toEqual({ sig: expect.any(String) })
    expect(await verifyChainAction(kp.publicKey, b64(d.sig), 'deactivate', subject, {})).toBe(true)
  })

  it('un sujet qui n’est pas celui de la clé est refusé : l’app ne signe jamais pour une autre identité', async () => {
    const { kp } = await signer()
    await expect(chainFieldFor(kp, `0x${'ab'.repeat(32)}`, 'checkin', { now: NOW, checkinFrequencyWeeks: 4 })).rejects.toThrow(/sujet/)
  })

  it('register sans les paramètres d’enregistrement, ou pause sans durée : erreur claire', async () => {
    const { kp, subject } = await signer()
    await expect(chainFieldFor(kp, null, 'checkin', { now: NOW, checkinFrequencyWeeks: 4 })).rejects.toThrow(/register/)
    await expect(chainFieldFor(kp, subject, 'pause', { now: NOW, checkinFrequencyWeeks: 4 })).rejects.toThrow(/pause/)
  })
})
