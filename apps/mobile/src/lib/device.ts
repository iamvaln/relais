// Le device : expo-secure-store derrière l'interface SecureStorage d'app-core,
// PinGuard, DeviceVault. Une instance pour l'app.

import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { DeviceVault, PinGuard, type SecureStorage, type SecureStorageOptions, BiometricRefusedError } from '@relais/app-core'

class ExpoSecureStorage implements SecureStorage {
  private options(o: SecureStorageOptions = {}): SecureStore.SecureStoreOptions {
    return {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      ...(o.requireAuthentication ? { requireAuthentication: true } : {}),
      ...(o.authenticationPrompt ? { authenticationPrompt: o.authenticationPrompt } : {}),
    }
  }

  async get(key: string, o?: SecureStorageOptions): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key, this.options(o))
    } catch (err) {
      if (o?.requireAuthentication) throw new BiometricRefusedError()
      throw err
    }
  }

  set(key: string, value: string, o?: SecureStorageOptions): Promise<void> {
    return SecureStore.setItemAsync(key, value, this.options(o))
  }

  delete(key: string): Promise<void> {
    return SecureStore.deleteItemAsync(key)
  }
}

export const secureStorage: SecureStorage = new ExpoSecureStorage()
export const device = new DeviceVault(secureStorage, new PinGuard(secureStorage), 'Déverrouiller Relais')

/** Face ID / empreinte disponibles et enrôlées sur ce téléphone ? */
export async function biometricsAvailable(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
}
