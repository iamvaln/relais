// Redis : compteurs d'échecs, jti des step-up tokens, inscriptions en attente,
// rate limiting. Aucune donnée chiffrée n'y transite (Backend Specs §1.1).

import { Redis } from 'ioredis'
import { env } from '../config/env.js'

let client: Redis | undefined

export function redis(): Redis {
  if (!client) {
    client = new Redis(env().REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      enableOfflineQueue: true,
    })
  }
  return client
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit()
    client = undefined
  }
}

// Préfixes de clés — un seul endroit pour les connaître.
export const keys = {
  /** Inscription en attente de validation OTP. TTL = validité OTP. */
  pendingRegistration: (email: string) => `reg:pending:${email}`,
  /** Échecs de mot de passe par compte (§2.5 : 5 → 15 min). */
  loginFailures: (userId: string) => `auth:login:fail:${userId}`,
  loginLock: (userId: string) => `auth:login:lock:${userId}`,
  /** jti d'un step-up token déjà consommé (usage unique, DEC-25). */
  stepUpUsed: (jti: string) => `auth:stepup:used:${jti}`,
  /** Token temporaire entre login et validation TOTP. */
  twoFactorPending: (token: string) => `auth:2fa:pending:${token}`,
  /** Échecs TOTP par temp_token au login (audit HIGH-4) : 5 → le temp_token est consommé. */
  twoFactorLoginFailures: (token: string) => `auth:2fa:fail:${token}`,
  /** Échecs TOTP par utilisateur (activation, désactivation) et verrou 15 min. */
  twoFactorFailures: (userId: string) => `auth:2fa:userfail:${userId}`,
  twoFactorLock: (userId: string) => `auth:2fa:lock:${userId}`,
  /** Dernier pas TOTP consommé par compte (`u:{userId}` ou `a:{adminId}`, audit LOW-14a) : un code ne sert qu'une fois. */
  twoFactorStep: (scope: string) => `auth:2fa:step:${scope}`,
  /** Seed prouvé par challenge Ed25519 (15 min) : condition de POST /vault/restore (audit LOW-13). */
  restoreProved: (userId: string) => `auth:restore:proved:${userId}`,
  /** Challenge de vérification annuelle d'un contact (5 min, usage unique — audit LOW-15). */
  verifyChallenge: (userId: string, contactId: string, id: string) => `tx:verify:${userId}:${contactId}:${id}`,
  /** Secret TOTP en cours d'activation, pas encore confirmé. */
  twoFactorSetup: (userId: string) => `auth:2fa:setup:${userId}`,
  /** Regénérations OTP par heure et par email (security.otp_max_regen_hr). */
  otpRegen: (email: string) => `otp:regen:${email}`,
  /** Session du back office (8 h) — sa présence vaut validité du token admin. */
  adminSession: (sid: string) => `admin:session:${sid}`,
  /** Dernier horodatage de sync accepté par catégorie (audit MEDIUM-7) : ni rejeu ni retour en arrière. */
  vaultSyncTs: (userId: string, category: string) => `vault:sync:ts:${userId}:${category}`,
  /** Erreurs du stockage objet, datées (sorted set) — alerte « stockage dégradé » du tableau de bord (12/09/2026). */
  storageErrors: () => 'storage:errors',
  /** Lot 2a : solde de l'opérateur (wei, texte) et résumé de la dernière réconciliation (JSON). */
  chainBalance: () => 'chain:balance_wei',
  chainReconcile: () => 'chain:reconcile:last',
  /** Défi de check-in en cours pour un utilisateur (24 h). */
  checkinGame: (userId: string) => `checkin:game:${userId}`,
  /** Jeu réussi, à échanger contre un check-in (usage unique, 15 min). */
  checkinToken: (token: string) => `checkin:token:${token}`,
} as const
