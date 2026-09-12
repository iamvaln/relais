// libsodium-wrappers-sumo : la build « sumo » expose crypto_pwhash (Argon2id),
// absent de la build standard qu'utilise l'API. Tout le cœur crypto passe par
// ce module. L'app mobile fait pointer ce nom de package vers
// react-native-libsodium (alias Metro), qui expose la même surface.

import sodium from 'libsodium-wrappers-sumo'

export default sodium

/** Attendre l'initialisation de libsodium avant un appel synchrone (sha256, contextSalt). */
export function ready(): Promise<void> {
  return sodium.ready
}
