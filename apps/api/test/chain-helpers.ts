// Anvil (Foundry) pour les tests de la chaîne : un nœud local éphémère par
// fichier de test, le contrat RelaisDms déployé depuis l'artefact
// `contracts/out` (forge build), l'opérateur = compte Anvil n° 1.

import { spawn, type ChildProcess } from 'node:child_process'
import { createPublicClient, createTestClient, createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { chainMessage, chainSubject, type ChainAction, type ChainFields } from '@relais/crypto-core'
import { readArtifact } from '../src/services/chain/artifact.js'
import { seal } from '../src/lib/enc.js'
import { relaisDmsAbi } from '../src/services/chain/abi.js'
import { GAMES } from '../src/api/checkin/games.js'
import { api, signWith, stepUp } from './helpers.js'
import { buildActivationBody, buildContactBody, secretQuestionIds, type ActivationContact, type Owner } from './transmission-helpers.js'

/** Comptes de test Anvil (mnémonique par défaut) — publics, sans valeur. */
export const ANVIL_DEPLOYER_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const ANVIL_OPERATOR_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
export const ANVIL_STRANGER_KEY: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
export const KEY_ENC_KEY = 'test-chain-key-enc-key-0123456789abcdef0123456789'

export interface AnvilHandle {
  rpcUrl: string
  contractAddress: `0x${string}`
  operatorAddress: `0x${string}`
  operatorKeyEnc: string
  /** Avance l'horloge du nœud de `seconds` et mine un bloc. */
  warp(seconds: number): Promise<void>
  stop(): Promise<void>
}

async function waitForRpc(url: string, child: ChildProcess): Promise<void> {
  const client = createPublicClient({ chain: foundry, transport: http(url) })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`anvil s'est arrêté (code ${child.exitCode})`)
    try {
      await client.getChainId()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('anvil ne répond pas')
}

export async function startAnvil(): Promise<AnvilHandle> {
  const port = 50_000 + (process.pid % 10_000)
  const rpcUrl = `http://127.0.0.1:${port}`
  const child = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' })
  await waitForRpc(rpcUrl, child)

  const deployer = privateKeyToAccount(ANVIL_DEPLOYER_KEY)
  const operator = privateKeyToAccount(ANVIL_OPERATOR_KEY)
  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl) })
  const wallet = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) })
  const testClient = createTestClient({ chain: foundry, mode: 'anvil', transport: http(rpcUrl) })
  const { bytecode } = readArtifact()
  const hash = await wallet.deployContract({ abi: relaisDmsAbi, bytecode, args: [operator.address] })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('déploiement sans adresse')

  return {
    rpcUrl,
    contractAddress: receipt.contractAddress,
    operatorAddress: operator.address,
    operatorKeyEnc: seal(ANVIL_OPERATOR_KEY, KEY_ENC_KEY),
    async warp(seconds) {
      await testClient.increaseTime({ seconds })
      await testClient.mine({ blocks: 1 })
    },
    async stop() {
      child.kill('SIGTERM')
      await new Promise((r) => child.once('exit', r))
    },
  }
}

/** L'horloge du nœud, en secondes Unix. */
export async function chainNow(rpcUrl: string): Promise<number> {
  const client = createPublicClient({ chain: foundry, transport: http(rpcUrl) })
  const block = await client.getBlock()
  return Number(block.timestamp)
}

export const DAY = 86_400
export function nextDay(ts: number): number {
  return (Math.floor(ts / DAY) + 1) * DAY
}

// --- Le rôle de l'app : sujet, signatures, activation on-chain -----------------------

export function subjectOf(o: Owner): `0x${string}` {
  return chainSubject(o.keys.publicKeyRaw)
}

export function chainSig(o: Owner, action: ChainAction, fields: ChainFields): string {
  return signWith(o.keys, Buffer.from(chainMessage(action, subjectOf(o), fields)))
}

/** L'échéance que l'app signe : maintenant + fréquence, arrondie au jour supérieur (secondes Unix). */
export function dueIn(weeks: number, from = Date.now()): number {
  return nextDay(Math.floor(from / 1000) + weeks * 7 * DAY)
}

export async function twoContacts(o: Owner): Promise<ActivationContact[]> {
  const [q1, q2, q3] = (await secretQuestionIds(3)) as [string, string, string]
  const contacts: ActivationContact[] = []
  for (const seed of [1, 2]) {
    const body = await buildContactBody(o.keys, o.relaisPk, { notification: { email: `contact${seed}@example.cm`, phone: '+237699000000' }, roles: { k1: true }, question_ids: [q1, q2, q3], secretSeed: seed })
    const r = await (await api()).post('/transmission/contacts').set(o.auth).send(body).expect(201)
    contacts.push({ id: r.body.data.id as string, body, seed })
  }
  return contacts
}

/** Active avec la signature `register` de l'owner : n=2, m=2, silence 3 mois, fréquence 4 semaines. */
export async function activateOnChain(o: Owner, override: Partial<{ next_due: number; sig: string }> = {}) {
  const contacts = await twoContacts(o)
  const next_due = override.next_due ?? dueIn(4)
  const fields: ChainFields = { nextDue: next_due, n: 2, m: 2, silenceSecs: 3 * 30 * DAY, checkinFreqSecs: 4 * 7 * DAY }
  const sig = override.sig ?? chainSig(o, 'register', fields)
  const su = await stepUp(o.accessToken, 'activate_transmission')
  const r = await (await api())
    .post('/transmission/activate')
    .set(o.auth)
    .set('X-Step-Up-Token', su)
    .send({ ...buildActivationBody(o.keys, contacts), chain: { next_due, sig } })
  return { r, next_due, contacts }
}

export function answerFor(gameId: string): string {
  const g = GAMES.find((x) => x.id === gameId)
  if (!g) throw new Error(`jeu inconnu : ${gameId}`)
  return g.answers.fr[0]!
}

export async function winToken(o: Owner): Promise<string> {
  const game = (await (await api()).get('/checkin/game').set(o.auth).expect(200)).body.data
  const r = await (await api()).post('/checkin/game/answer').set(o.auth).send({ answer: answerFor(game.game_id) }).expect(200)
  return r.body.data.checkin_token as string
}

/** Après un saut d'horloge, les jetons sont périmés : nouvelle connexion. */
export async function relogin(o: Owner): Promise<void> {
  const r = await (await api()).post('/auth/login').send({ email: o.email, password: o.password }).expect(200)
  o.accessToken = r.body.data.access_token as string
  o.auth = { Authorization: `Bearer ${o.accessToken}` }
}
