// Bout en bout : le cœur crypto de l'app (@relais/crypto-core) contre la vraie
// API, de l'inscription à la reconstitution post-mortem. Prouve que les deux
// côtés parlent le même langage — et que le serveur ne voit jamais un clair.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  answerRelay,
  buildActivationBody,
  buildContactBody,
  buildDeleteSignature,
  buildEntryPayload,
  buildSyncPayload,
  checkVerifyToken,
  deriveCategoryKeys,
  deriveContactKey,
  deriveSigningKeypair,
  encryptLocal,
  fromBase64,
  generateMnemonic,
  mnemonicToSeed,
  open,
  openBackup,
  openSecret,
  reconstruct,
  signPayload,
  signRaw,
  toBase64,
  type ContactPlan,
  type QuestionIds,
} from '@relais/crypto-core'
import { trigger } from '../src/jobs/deadman.js'
import { prisma } from '../src/lib/prisma.js'
import { api, closeAll, mailbox, registerKey, registerUser, resetState, stepUp } from './helpers.js'
import { relayTokenFromEmail, secretQuestionIds } from './transmission-helpers.js'

beforeEach(resetState)
afterAll(closeAll)

describe('crypto-core ↔ API', () => {
  it('inscription → clé → restauration → coffre → contacts → activation → vérification annuelle → déclenchement → relay → reconstitution → carnet', async () => {
    const client = await api()
    const u = await registerUser('adjoua@example.cm')
    const auth = { Authorization: `Bearer ${u.accessToken}` }

    // 12 mots (FR), seed, clés — comme à l'inscription (Frontend §3.1)
    const words = generateMnemonic('fr')
    const seed = mnemonicToSeed(words)
    const keys = await deriveCategoryKeys(seed)
    const signer = await deriveSigningKeypair(seed)
    await registerKey(u.accessToken, toBase64(signer.publicKey))

    // Nouveau device (DEC-06) : les 12 mots suffisent à prouver la possession
    const ch = await client.get('/auth/restore/challenge').set(auth).expect(200)
    const again = await deriveSigningKeypair(mnemonicToSeed(words))
    const sig = await signRaw(fromBase64(ch.body.data.challenge), again.privateKey)
    const restored = await client.post('/auth/restore/verify').set(auth).send({ challenge_id: ch.body.data.challenge_id, signature: toBase64(sig) }).expect(200)
    expect(restored.body.data.verified).toBe(true)

    // Coffre : D → P1 (local) → P2 signé → /vault/sync ; /vault/restore → D
    const D = new TextEncoder().encode(JSON.stringify([{ service: 'Orange Money', login: '+237699000000', password: 'secret' }]))
    const p1 = await encryptLocal(keys.k1, D)
    const sync = await buildSyncPayload('accounts', keys.k1, p1, signer.privateKey)
    await client.post('/vault/sync').set(auth).send(sync).expect(200)
    const restore = await client.post('/vault/restore').set(auth).send({ category: 'accounts' }).expect(200)
    const back = await openBackup(keys.k1, fromBase64(restore.body.data.payload))
    expect(Buffer.from(back.data)).toEqual(Buffer.from(D))
    // Ce qui est sur le serveur n'est pas D
    expect(Buffer.from(fromBase64(sync.payload)).includes(Buffer.from('Orange'))).toBe(false)

    // Contacts : sealed box + secret_enc, puis activation 2-of-2 avec parts signées
    const relaisPk = (await client.get('/transmission/relais-key').expect(200)).body.data.relais_x25519_pk as string
    const qids = (await secretQuestionIds(3)) as QuestionIds
    const plans: ContactPlan[] = [1, 2].map((i) => ({
      id: '',
      roles: { k1: true, k2: true, k3: false },
      questionIds: qids,
      answers: [`Yaoundé ${i}`, `Rex ${i}`, `199${i}`],
      notification: { email: `contact${i}@example.cm`, phone: '+237699000000', owner_display_name: 'Adjoua' },
      secret: { nom: `Contact ${i}`, role: 'famille', message_personnel: `Merci ${i}` },
    }))
    for (const plan of plans) {
      const body = await buildContactBody({ keys, signer, relaisPk }, plan)
      const r = await client.post('/transmission/contacts').set(auth).send(body).expect(201)
      plan.id = r.body.data.id as string
    }
    const activation = await buildActivationBody({ keys, signer, relaisPk, contacts: plans, schema: { n: 2, m: 2 }, silence_duration_months: 3, checkin_frequency_weeks: 4 })
    mailbox.clear()
    const su = await stepUp(u.accessToken, 'activate_transmission')
    const act = await client.post('/transmission/activate').set(auth).set('X-Step-Up-Token', su).send(activation)
    expect(act.status, JSON.stringify(act.body)).toBe(200)
    expect(act.body.data).toEqual({ activated: true, contacts_notified: 2 })
    expect(mailbox.last()?.text).toContain('Adjoua')

    // Vérification annuelle : réponses vérifiées en local, attestation signée
    const cfg = await client.get('/transmission/config').set(auth).expect(200)
    const c1 = cfg.body.data.contacts.find((c: { id: string }) => c.id === plans[0]!.id)
    const kc1 = await deriveContactKey(plans[0]!.answers, qids)
    expect(await checkVerifyToken(kc1, c1.verify_token)).toBe(true)
    // Audit LOW-15 : l'attestation signe SHA256(verify_token ‖ challenge serveur), challenge à usage unique
    const vch = (await client.get(`/transmission/contacts/${plans[0]!.id}/verify-challenge`).set(auth).expect(200)).body.data
    const attestation = await signPayload(Buffer.concat([fromBase64(c1.verify_token), fromBase64(vch.challenge)]), signer.privateKey)
    await client.post(`/transmission/contacts/${plans[0]!.id}/verify`).set(auth).send({ challenge_id: vch.challenge_id, signature: toBase64(attestation) }).expect(200)

    // Déclenchement (le job) puis relay : mauvaises réponses détectées en local, bonnes → parts en escrow
    await prisma().transmission_configs.update({ where: { user_id: u.userId }, data: { status: 'triggered' } })
    mailbox.clear()
    await trigger(new Date())
    const tokens = [relayTokenFromEmail('contact1@example.cm'), relayTokenFromEmail('contact2@example.cm')]
    const deposits = []
    for (const [i, token] of tokens.entries()) {
      const link = (await client.get(`/relay/${token}`).expect(200)).body.data
      expect(link.questions.map((q: { id: string }) => q.id)).toEqual(qids)
      expect(await answerRelay(link, ['faux', 'faux', 'faux'])).toEqual({ ok: false })
      const failed = await client.post(`/relay/${token}/verify`).send({ failed: true }).expect(200)
      expect(failed.body.data).toEqual({ accepted: false, attempts_left: 4 })
      const answer = await answerRelay(link, plans[i]!.answers)
      if (!answer.ok) throw new Error('réponses refusées en local')
      const r = await client.post(`/relay/${token}/verify`).send({ shares: answer.shares })
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      deposits.push(r.body.data)
    }
    expect(deposits[1].unlocked).toEqual({ k1: true, k2: true, k3: false })

    // Reconstitution sur le device du contact : N parts → K1 → P2 ouvert (P1) → D ; secret_enc lisible via K2
    const data = (await client.get(`/relay/${tokens[0]}/data`).expect(200)).body.data
    const out = await reconstruct(data)
    expect(Buffer.from(await open(keys.k1, out.categories.k1!.data!))).toEqual(Buffer.from(D))
    expect(out.categories.k2!.data).toBeNull()
    expect(await openSecret(out.categories.k2!.key, data.secret_enc)).toEqual({ nom: 'Contact 1', role: 'famille', message_personnel: 'Merci 1' })

    // Carnet : entrée signée, suppression signée (l'owner est vivant dans ce scénario-ci)
    const entry = await buildEntryPayload(keys.k2, { question_id: null, entry_month: new Date().toISOString().slice(0, 7) + '-01', mode: 'free', texte: 'Un mois ordinaire' }, signer.privateKey)
    const created = await client.post('/journal/entries').set(auth).send(entry)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const del = await buildDeleteSignature(created.body.data.id, signer.privateKey)
    await client.delete(`/journal/entries/${created.body.data.id}`).set(auth).send(del).expect(200)
  })
})
