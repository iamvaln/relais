// Client du contrat RelaisDms (docs/smart-contract-v2.md §2-§3) : lecture de
// l'état d'un sujet, écritures de l'opérateur (simulées avant envoi, reçu
// attendu), événements `Triggered`, solde et horloge. Un seul processus signe
// (le worker de la file `chain`, concurrence 1) : le nonce n'a pas de rival.
// Désactivé (CHAIN_ENABLED=false), le service refuse tout appel clairement.

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { env } from '../../config/env.js'
import { relaisDmsAbi } from './abi.js'
import { operatorAccount } from './keys.js'

export { relaisDmsAbi } from './abi.js'

export type DmsStatus = 'inactive' | 'active' | 'paused' | 'triggered' | 'completed'
const STATUSES: DmsStatus[] = ['inactive', 'active', 'paused', 'triggered', 'completed']

export interface DmsView {
  status: DmsStatus
  n: number
  m: number
  silenceSecs: number
  checkinFreqSecs: number
  /** Secondes Unix, 0 si jamais posée. */
  nextCheckinDue: number
  pausedUntil: number
  triggeredAt: number
  ed25519Pk: Hex
}

type WriteFn = ContractFunctionName<typeof relaisDmsAbi, 'nonpayable'>
export type ChainCall = {
  [F in WriteFn]: { fn: F; args: ContractFunctionArgs<typeof relaisDmsAbi, 'nonpayable', F> }
}[WriteFn]

export interface ChainWriteResult {
  txHash: Hex
  blockNumber: bigint
}

export interface TriggeredEvent {
  at: number
  by: Address
  blockNumber: bigint
  txHash: Hex
}

/** Le contrat a refusé : `reason` est le nom de l'erreur Solidity (BadStatus, NotTriggerable…). */
export class ChainRevertError extends Error {
  constructor(
    readonly fn: string,
    readonly reason: string,
  ) {
    super(`chaîne : ${fn} refusé par le contrat (${reason})`)
    this.name = 'ChainRevertError'
  }
}

export interface ChainService {
  readonly enabled: boolean
  readonly contractAddress: Address | null
  readonly operatorAddress: Address | null
  chainId(): Promise<number>
  blockNumber(): Promise<bigint>
  operatorBalanceWei(): Promise<bigint>
  readDms(subject: Hex): Promise<DmsView>
  triggerable(subject: Hex): Promise<boolean>
  /** Secondes avant déclenchement ; 0 si déclenchable ; Infinity si le minuteur ne court pas. */
  secondsUntilTriggerable(subject: Hex): Promise<number>
  write(call: ChainCall): Promise<ChainWriteResult>
  /** Le dernier événement `Triggered` du sujet, ou null. */
  lastTriggered(subject: Hex): Promise<TriggeredEvent | null>
  shareHashes(subject: Hex): Promise<readonly Hex[]>
}

export interface ChainServiceOptions {
  rpcUrl: string
  contractAddress: Address
  operatorKeyEnc: string
  keyEncKey: string
}

const MAX_UINT256 = (1n << 256n) - 1n

class ViemChainService implements ChainService {
  readonly enabled = true
  readonly contractAddress: Address
  readonly operatorAddress: Address
  private readonly account: PrivateKeyAccount
  private readonly rpcUrl: string
  private clients?: Promise<{ chain: Chain; pub: PublicClient; wallet: WalletClient }>

  constructor(opts: ChainServiceOptions) {
    this.rpcUrl = opts.rpcUrl
    this.contractAddress = opts.contractAddress
    this.account = operatorAccount(opts.operatorKeyEnc, opts.keyEncKey)
    this.operatorAddress = this.account.address
  }

  /** La chaîne est décrite par son RPC : l'identifiant est lu au premier appel, jamais supposé. */
  private ready() {
    this.clients ??= (async () => {
      const probe = createPublicClient({ transport: http(this.rpcUrl) })
      const id = await probe.getChainId()
      const chain = defineChain({ id, name: `relais-chain-${id}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.rpcUrl] } } })
      const pub = createPublicClient({ chain, transport: http(this.rpcUrl) })
      const wallet = createWalletClient({ account: this.account, chain, transport: http(this.rpcUrl) })
      return { chain, pub, wallet }
    })()
    return this.clients
  }

  async chainId(): Promise<number> {
    return (await this.ready()).chain.id
  }

  async blockNumber(): Promise<bigint> {
    return (await this.ready()).pub.getBlockNumber()
  }

  async operatorBalanceWei(): Promise<bigint> {
    return (await this.ready()).pub.getBalance({ address: this.operatorAddress })
  }

  async readDms(subject: Hex): Promise<DmsView> {
    const { pub } = await this.ready()
    const d = await pub.readContract({ address: this.contractAddress, abi: relaisDmsAbi, functionName: 'get', args: [subject] })
    return {
      status: STATUSES[d.status] ?? 'inactive',
      n: d.n,
      m: d.m,
      silenceSecs: d.silenceSecs,
      checkinFreqSecs: d.checkinFreqSecs,
      nextCheckinDue: Number(d.nextCheckinDue),
      pausedUntil: Number(d.pausedUntil),
      triggeredAt: Number(d.triggeredAt),
      ed25519Pk: d.ed25519Pk,
    }
  }

  async triggerable(subject: Hex): Promise<boolean> {
    const { pub } = await this.ready()
    return pub.readContract({ address: this.contractAddress, abi: relaisDmsAbi, functionName: 'triggerable', args: [subject] })
  }

  async secondsUntilTriggerable(subject: Hex): Promise<number> {
    const { pub } = await this.ready()
    const s = await pub.readContract({ address: this.contractAddress, abi: relaisDmsAbi, functionName: 'secondsUntilTriggerable', args: [subject] })
    return s === MAX_UINT256 ? Number.POSITIVE_INFINITY : Number(s)
  }

  async write(call: ChainCall): Promise<ChainWriteResult> {
    const { pub, wallet, chain } = await this.ready()
    let request
    try {
      // La simulation porte le nom de l'erreur du contrat ; un envoi direct ne rendrait qu'un reçu en échec.
      ;({ request } = await pub.simulateContract({
        address: this.contractAddress,
        abi: relaisDmsAbi,
        functionName: call.fn,
        args: call.args,
        account: this.account,
      } as Parameters<typeof pub.simulateContract>[0]))
    } catch (err) {
      throw asRevert(call.fn, err)
    }
    const txHash = await wallet.writeContract({ ...request, chain, account: this.account })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') throw new ChainRevertError(call.fn, 'reverted')
    return { txHash, blockNumber: receipt.blockNumber }
  }

  async shareHashes(subject: Hex): Promise<readonly Hex[]> {
    const { pub } = await this.ready()
    return pub.readContract({ address: this.contractAddress, abi: relaisDmsAbi, functionName: 'shareHashes', args: [subject] })
  }

  async lastTriggered(subject: Hex): Promise<TriggeredEvent | null> {
    const { pub } = await this.ready()
    const logs = await pub.getContractEvents({ address: this.contractAddress, abi: relaisDmsAbi, eventName: 'Triggered', args: { subject }, fromBlock: 0n, toBlock: 'latest' })
    const last = logs.at(-1)
    if (!last || last.args.at === undefined || !last.args.by) return null
    return { at: Number(last.args.at), by: last.args.by, blockNumber: last.blockNumber, txHash: last.transactionHash }
  }
}

function asRevert(fn: string, err: unknown): Error {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) return new ChainRevertError(fn, revert.data?.errorName ?? revert.reason ?? 'revert')
  }
  return err instanceof Error ? err : new Error(String(err))
}

class DisabledChainService implements ChainService {
  readonly enabled = false
  readonly contractAddress = null
  readonly operatorAddress = null
  private off(): never {
    throw new Error('chaîne désactivée (CHAIN_ENABLED=false)')
  }
  chainId(): Promise<number> {
    return Promise.reject(this.safeOff())
  }
  blockNumber(): Promise<bigint> {
    return Promise.reject(this.safeOff())
  }
  operatorBalanceWei(): Promise<bigint> {
    return Promise.reject(this.safeOff())
  }
  readDms(): Promise<DmsView> {
    return Promise.reject(this.safeOff())
  }
  triggerable(): Promise<boolean> {
    return Promise.reject(this.safeOff())
  }
  secondsUntilTriggerable(): Promise<number> {
    return Promise.reject(this.safeOff())
  }
  write(): Promise<ChainWriteResult> {
    return Promise.reject(this.safeOff())
  }
  lastTriggered(): Promise<TriggeredEvent | null> {
    return Promise.reject(this.safeOff())
  }
  shareHashes(): Promise<readonly Hex[]> {
    return Promise.reject(this.safeOff())
  }
  private safeOff(): Error {
    try {
      this.off()
    } catch (e) {
      return e as Error
    }
  }
}

export function createChainService(opts: ChainServiceOptions): ChainService {
  return new ViemChainService(opts)
}

let instance: ChainService | undefined

export function chainService(): ChainService {
  if (!instance) {
    const e = env()
    instance =
      e.CHAIN_ENABLED === 'true'
        ? createChainService({ rpcUrl: e.CHAIN_RPC_URL!, contractAddress: e.CHAIN_CONTRACT_ADDRESS as Address, operatorKeyEnc: e.CHAIN_OPERATOR_KEY_ENC!, keyEncKey: e.CHAIN_KEY_ENC_KEY! })
        : new DisabledChainService()
  }
  return instance
}

export function setChainServiceForTests(svc: ChainService | undefined): void {
  instance = svc
}
