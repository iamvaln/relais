// Stockage sécurisé du device, vu par la logique de l'app. Valeurs en
// chaînes (base64 ou JSON). L'adaptateur réel est expo-secure-store
// (Keychain iOS / Keystore Android) ; MemorySecureStorage sert aux tests.
//
// requireAuthentication : la lecture exige Face ID / empreinte / code du
// téléphone (biométrie, E1-US03). L'adaptateur mémoire l'honore via un
// `biometricGate` injectable, pour tester refus et accord.

export interface SecureStorageOptions {
  requireAuthentication?: boolean
  authenticationPrompt?: string
}

export interface SecureStorage {
  get(key: string, options?: SecureStorageOptions): Promise<string | null>
  set(key: string, value: string, options?: SecureStorageOptions): Promise<void>
  delete(key: string): Promise<void>
}

export class BiometricRefusedError extends Error {
  constructor() {
    super('Authentification biométrique refusée')
    this.name = 'BiometricRefusedError'
  }
}

export class MemorySecureStorage implements SecureStorage {
  private readonly items = new Map<string, { value: string; requireAuthentication: boolean }>()
  /** Simule la réponse du device à une demande biométrique. */
  biometricGate: () => Promise<boolean> = async () => true

  async get(key: string): Promise<string | null> {
    const item = this.items.get(key)
    if (!item) return null
    if (item.requireAuthentication && !(await this.biometricGate())) throw new BiometricRefusedError()
    return item.value
  }

  async set(key: string, value: string, options: SecureStorageOptions = {}): Promise<void> {
    this.items.set(key, { value, requireAuthentication: options.requireAuthentication === true })
  }

  async delete(key: string): Promise<void> {
    this.items.delete(key)
  }

  keys(): string[] {
    return [...this.items.keys()]
  }
}
