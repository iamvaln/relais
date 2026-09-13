// Check-in et carnet : des services minces sur le client API et le KeyStore.

import { Checkin, Journal } from '@relais/app-core'
import { api } from '@/lib/api'
import { keyStore } from './keystore'
import { openTransmission } from './transmission'

// Lot 3a : le check-in est signé pour la chaîne Arbitrum — la clé du seed et
// la config (sujet, fréquence, schéma, contacts) viennent de la transmission ouverte.
export const checkin = new Checkin(api, {
  signer: () => {
    const s = keyStore.getState().signer
    if (!s) throw new Error('coffre verrouillé')
    return s
  },
  config: async () => (await openTransmission()).tx.config(),
})

export const journal = new Journal({
  api,
  keys: () => {
    const k = keyStore.getState().keys
    if (!k) throw new Error('coffre verrouillé')
    return k
  },
  signer: () => {
    const s = keyStore.getState().signer
    if (!s) throw new Error('coffre verrouillé')
    return s
  },
})
