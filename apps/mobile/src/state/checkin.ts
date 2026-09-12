// Check-in et carnet : des services minces sur le client API et le KeyStore.

import { Checkin, Journal } from '@relais/app-core'
import { api } from '@/lib/api'
import { keyStore } from './keystore'

export const checkin = new Checkin(api)

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
