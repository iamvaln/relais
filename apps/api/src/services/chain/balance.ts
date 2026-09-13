// Le solde de l'opérateur, relevé à chaque drain et réconciliation — lu par le
// tableau de bord (chain_gas_low). Module à part pour ne créer aucun cycle
// entre la file (sync.ts) et la réconciliation (reconcile.ts).

import { keys, redis } from '../../lib/redis.js'
import { logger } from '../../lib/logger.js'
import type { ChainService } from './index.js'

export async function recordBalance(svc: ChainService): Promise<void> {
  try {
    await redis().set(keys.chainBalance(), (await svc.operatorBalanceWei()).toString())
  } catch (err) {
    logger().warn({ err: err instanceof Error ? err.message : String(err) }, 'chaîne : solde opérateur illisible')
  }
}
