RELAIS
Passe le relais, pas le chaos.
Frontend Specs — Version 1.0
Avril 2026 — Confidentiel
| 1 — Stack & ArchitectureTechnologies, structure de projet, principes fondamentaux. |

## 1.1 Stack technique
| Couche | Technologie | Justification |
| Framework | React Native (Expo bare workflow) | iOS + Android. Bare workflow pour accès natif complet (SQLCipher, Keychain). |
| Langage | TypeScript strict | Cohérence avec le backend. Sécurité des types sur les buffers crypto. |
| Navigation | Expo Router (file-based) | Routing déclaratif, deep links, guards de navigation simples. |
| State management | Zustand | Léger, sans boilerplate. Stores session, KeyStore, sync. |
| Requêtes API | TanStack Query | Cache, retry, invalidation, états loading/error automatiques. |
| Crypto | libsodium-wrappers | XChaCha20, Argon2id, Shamir — toutes les primitives du projet. |
| Base locale | expo-sqlite + SQLCipher | SQLite chiffré on-device avec K1/K2/K3. |
| Stockage sécurisé | expo-secure-store | Keychain iOS / Keystore Android. Refresh token + pin hash. |
| Biométrie | expo-local-authentication | Face ID, Touch ID, empreinte Android. |
| Notifications | expo-notifications | Push pour check-in, relances, transmissions. |
| Tests | Jest + RNTL | Tests unitaires crypto + tests composants. |

## 1.2 Principes frontend
- Crypto-first — toute donnée sensible est chiffrée avant d'être écrite sur le disque ou envoyée au réseau
- Memory-safe — K1/K2/K3 en mémoire vive uniquement. Jamais en AsyncStorage, jamais sur disque en clair.
- Offline-first — lecture depuis SQLite local sans réseau. Sync asynchrone en arrière-plan.
- PIN-gate client — le PIN ne transite jamais sur le réseau. Sa validation est 100% côté client.
- Zero-trust UI — les données sensibles ne sont jamais loggées ni affichées sans interaction explicite.
## 1.3 Structure du projet
| app/ # Expo Router — pages├── (auth)/ # Groupe non-authentifié│ ├── login.tsx│ ├── register.tsx│ ├── verify-email.tsx│ └── seed-words.tsx├── (app)/ # Groupe authentifié│ ├── dashboard.tsx│ ├── vault/│ ├── transmission/│ ├── checkin/│ ├── journal/│ └── settings/├── relay/ # Groupe public (trusted contacts)│ └── [token].tsx└── _layout.tsx # Root layout + guardssrc/├── crypto/ # Toutes les opérations cryptographiques│ ├── keystore.ts # K1/K2/K3 en mémoire vive│ ├── vault.ts # Chiffrement/déchiffrement│ ├── shamir.ts # Shamir split/combine│ ├── argon2.ts # Dérivation de clés│ ├── pin-gate.ts # PIN gate + step-up token│ └── verify-token.ts # Verify token pour révision annuelle├── db/ # SQLite chiffré│ ├── client.ts # Connexion SQLCipher│ ├── accounts.ts│ ├── messages.ts│ └── finances.ts├── api/ # TanStack Query clients├── stores/ # Zustand stores└── components/ # Composants réutilisables |

| 2 — Authentification côté clientTokens, sessions, déconnexion automatique. |

## 2.1 Stockage des tokens
| AsyncStorage n'est jamais utilisé pour des tokens ou des clés. C'est un stockage non chiffré. expo-secure-store utilise le Keychain iOS et le Keystore Android — chiffrés par l'OS. |

| Token | Stockage | Justification |
| Access Token (JWT 15min) | Mémoire vive — Zustand store | Jamais persisté. Perdu si l'app est tuée. Normal. |
| Refresh Token (3 mois) | expo-secure-store (Keychain/Keystore) | Seul token persisté. Chiffré par l'OS. |
| Step-up Token (5min) | Mémoire vive uniquement | Usage unique, très court-vécu. Jamais persisté. |

## 2.2 Renouvellement automatique
| // Intercepteur TanStack Query — avant chaque requêteif (accessToken && isExpiringSoon(accessToken, 60)) { const newToken = await POST('/auth/refresh') // cookie HttpOnly sessionStore.setAccessToken(newToken)}// Si 401 reçu :// → Tenter un refresh// → Si refresh échoue → sessionStore.clear() + KeyStore.clear()// → Redirect vers /login |

## 2.3 Déconnexion automatique (3 mois)
| // Vérification au démarrage de l'appconst lastActive = await SecureStore.get('last_active_at')const threeMonths = 90 * 24 * 60 * 60 * 1000if (Date.now() - lastActive > threeMonths) { KeyStore.clear() // Détruit K1 K2 K3 sessionStore.clear() await SecureStore.delete('refresh_token') await SecureStore.delete('master_key_enc') router.replace('/login') // Mot de passe complet requis}// À chaque ouverture active :await SecureStore.set('last_active_at', Date.now().toString()) |

| 3 — KeyStore — Gestion des clés en mémoireLe composant le plus critique du frontend. K1/K2/K3 ne touchent jamais le disque en clair. |

| Le KeyStore est un singleton en mémoire vive. Il contient K1, K2, K3 dérivées du seed. Il est détruit à la fermeture, à la déconnexion, et au verrouillage PIN après 10 minutes d'inactivité. |

## 3.1 Interface
| interface KeyStore { // Dérivation deriveFromSeed(seed: Uint8Array): Promise<void> deriveFromPassword(password: string): Promise<void> deriveFromMasterKey(masterKeyEnc: Uint8Array, pin: string): Promise<void> // Accès (lecture seule) getK1(): Uint8Array // Comptes & accès getK2(): Uint8Array // Messages & journal getK3(): Uint8Array // Données financières // État isUnlocked(): boolean // Destruction — zéroïse les buffers clear(): void} |

## 3.2 États de la session
| État | KeyStore | Déverrouillage | seed_enc_pin |
| App active, session valide | K1 K2 K3 en mémoire | — | Présent |
| App en arrière-plan > 10min | K1 K2 K3 détruites | PIN ou biométrie | Présent |
| App rouverte — PIN valide | K1 K2 K3 recalculées depuis seed | — | Présent |
| Inactivité > 3 mois | K1 K2 K3 détruites | Mot de passe → PIN → seed | Présent (jamais supprimé) |
| Nouveau device / réinstallation | Vides | PIN + 12 mots | Absent → créé après |

## 3.3 seed_enc_pin — stockage permanent
| seed_enc_pin n'est JAMAIS supprimé. Même après 3 mois d'inactivité. C'est le seul mécanisme de récupération locale sans les 12 mots physiques. Le supprimer créerait le pire scénario : données inaccessibles si 12 mots perdus. |

| // À l'inscription ou premier login avec 12 motsconst pin_key = await Argon2id(pin, pin_salt, ctx='relais_pin_enc_v1')const seed_enc_pin = encrypt(seed, pin_key)await SecureStore.set('seed_enc_pin', seed_enc_pin) // PERMANENT// Au déverrouillage PIN (app revenue au premier plan)const pin_key = await Argon2id(pin_saisi, pin_salt, ctx='relais_pin_enc_v1')const seed = decrypt(seed_enc_pin, pin_key)await KeyStore.deriveFromSeed(seed) // K1 K2 K3 identiques ✅seed.fill(0) // Zéroïse immédiatement// Après 3 mois d'inactivité// seed_enc_pin → toujours présent// Login mot de passe → tokens → app demande PIN// PIN → déchiffre seed_enc_pin → K1 K2 K3 ✅// Pas besoin des 12 mots ✅// Nouveau device / réinstallation (seed_enc_pin absent)// 1. Login mot de passe → tokens// 2. App détecte : seed_enc_pin absent// 3. 'Créez votre PIN pour ce téléphone'// 4. 'Entrez vos 12 mots pour restaurer votre coffre'// 5. seed_enc_pin créé avec nouveau PIN ✅ |

| 4 — PIN GateValidation PIN locale et émission du step-up token. |

| Le PIN ne transite jamais sur le réseau. Le backend reçoit uniquement une demande de step-up token, après que le client a validé le PIN localement. C'est une délégation de confiance basée sur l'access token. |

## 4.1 Flow complet
| async function pinGate(action: StepUpAction): Promise<string> { // 1. Afficher l'écran PIN/biométrie const verified = await showPinScreen() if (!verified) throw new PinCancelledError() // 2. Vérifier localement (comparaison temps constant) const salt = await SecureStore.get('pin_salt') const hash = await Argon2id(enteredPin + salt) const stored = await SecureStore.get('pin_verify_hash') if (!sodium.memcmp(hash, stored)) { await incrementPinFailure() throw new PinInvalidError() } // 3. Demander step-up token au backend const { step_up_token } = await api.post('/auth/pin/step-up', { action }) return step_up_token}// Usageconst token = await pinGate('edit_contacts')await api.put('/transmission/contacts/123', data, { headers: { 'X-Step-Up-Token': token }}) |

## 4.2 Stockage du PIN hash
| // À la création du PINconst pin_salt = sodium.randombytes_buf(32)const pin_verify_hash = await Argon2id(pin + pin_salt)await SecureStore.set('pin_verify_hash', pin_verify_hash)await SecureStore.set('pin_salt', pin_salt)// IMPORTANT : sodium.memcmp() pour comparaison temps constant// Évite les timing attacks |

## 4.3 Actions step-up
| Endpoint | Action code |
| PUT /transmission/config | edit_transmission |
| POST /transmission/activate | activate_transmission |
| PUT/DELETE /transmission/contacts/:id | edit_contacts |
| PUT /auth/password | change_password |
| GET /auth/seed-words | view_seed |
| DELETE /auth/2fa | disable_2fa |
| POST /admin/* | admin_action |

| 5 — Cryptographie côté clientToutes les opérations crypto avec libsodium. |

## 5.1 Dérivation de clés
| // src/crypto/argon2.tsconst CONTEXTS = { accounts: 'relais_comptes_v1', messages: 'relais_messages_v1', finances: 'relais_finances_v1', master: 'relais_master_v1', pinEnc: 'relais_pin_enc_v1',}async function deriveKey(input: Uint8Array, context: string): Promise<Uint8Array> { return sodium.crypto_pwhash( 32, // 256 bits input, sodium.from_string(context), // sel = contexte sodium.crypto_pwhash_OPSLIMIT_MODERATE, sodium.crypto_pwhash_MEMLIMIT_MODERATE, sodium.crypto_pwhash_ALG_ARGON2ID13 )} |

## 5.2 Chiffrement des données
| // XChaCha20-Poly1305 via libsodium// Nonce aléatoire de 24 bytes stocké avec le ciphertextfunction encrypt(data: Uint8Array, key: Uint8Array): Uint8Array { const nonce = sodium.randombytes_buf(24) const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt( data, null, null, nonce, key ) // Format stocké : [nonce(24)] + [ciphertext] return concat(nonce, cipher) function decrypt(encrypted: Uint8Array, key: Uint8Array): Uint8Array { const nonce = encrypted.slice(0, 24) const cipher = encrypted.slice(24) return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt( null, cipher, null, nonce, key ) // Throw si authentification échoue} |

## 5.3 Shamir Secret Sharing
| // Bibliothèque : shamirs-secret-sharingimport { split, combine } from 'shamirs-secret-sharing'// Découpe K en M parts, N suffisent (N-of-M)function splitKey(key: Uint8Array, total: number, threshold: number): Buffer[] { return split(Buffer.from(key), { shares: total, threshold }) // Reconstitue K depuis N partsfunction combineShares(shares: Buffer[]): Uint8Array { return new Uint8Array(combine(shares)) // Chiffre une part pour un contactfunction encryptShare(share: Buffer, responses: string[]): Uint8Array { const K_i = deriveKey(Buffer.from(responses.join('|')), 'relais_contact_v1') return encrypt(share, K_i)} |

## 5.4 Ed25519 — Keypair, signatures et restauration
| // Dérivé du seed à la création du compteimport * as ed from '@noble/ed25519'async function deriveEd25519(seed: Uint8Array) { // Déterministe — même seed = même keypair const sk = seed.slice(0, 32) // 32 premiers bytes du seed const pk = await ed.getPublicKeyAsync(sk) return { sk, pk }}// ed25519_pk → envoyée au serveur à l'inscription// ed25519_sk → dérivée à la demande, JAMAIS stockée// Signature d'un sync vaultasync function signVault(P1: Uint8Array, sk: Uint8Array): Promise<Uint8Array> { const hash = sha256(P1) const sig = await ed.signAsync(hash, sk) sk.fill(0) // Zéroïse sk après usage return sig}// Challenge-response pour restaurationasync function signChallenge(challenge: Buffer, sk: Uint8Array): Promise<Uint8Array> { const sig = await ed.signAsync(challenge, sk) sk.fill(0) return sig} |

## 5.5 Verify token
| const VERIFY_PLAINTEXT = new TextEncoder().encode('RELAIS_VERIFY_OK_V1')// Créé au setup des questionsfunction createVerifyToken(responses: string[]): Uint8Array { const K_i = deriveKey(Buffer.from(responses.join('|')), 'relais_contact_v1') return encrypt(VERIFY_PLAINTEXT, K_i) // Vérifié lors de la révision annuellefunction checkVerifyToken(responses: string[], token: Uint8Array): boolean { try { const K_i = deriveKey(Buffer.from(responses.join('|')), 'relais_contact_v1') const result = decrypt(token, K_i) return sodium.memcmp(result, VERIFY_PLAINTEXT) } catch { return false }} |

| 6 — Base locale — SQLCipherStockage chiffré on-device. Source de vérité. |

## 6.1 Architecture
| // 3 bases SQLite, chacune chiffrée avec sa Ki// relais_accounts.db → chiffrée avec K1// relais_messages.db → chiffrée avec K2// relais_finances.db → chiffrée avec K3// relais_meta.db → non chiffrée (metadata de sync)async function getDB(category: Category) { if (!KeyStore.isUnlocked()) throw new KeyStoreLockedError() if (!dbs[category]) { const key = KeyStore.getKey(category) dbs[category] = await SQLiteDatabase.open({ name: `relais_${category}.db`, key: bufferToHex(key), // SQLCipher key }) } return dbs[category] // Fermeture au verrouillageasync function closeAllDBs() { for (const db of Object.values(dbs)) await db.closeAsync()} |

## 6.2 Schéma local
| -- relais_accounts.dbCREATE TABLE accounts ( id TEXT PRIMARY KEY, service_name TEXT NOT NULL, -- non chiffré (affichage liste) urgency_level TEXT DEFAULT 'discretion', content_enc BLOB NOT NULL, -- {login, password, instructions} sync_status TEXT DEFAULT 'pending', updated_at INTEGER NOT NULL);-- relais_messages.dbCREATE TABLE personal_messages ( id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, content_enc BLOB NOT NULL, updated_at INTEGER NOT NULL);CREATE TABLE journal_entries ( id TEXT PRIMARY KEY, question_id TEXT NOT NULL, month TEXT NOT NULL, mode TEXT NOT NULL, content_enc BLOB NOT NULL, word_count_approx INTEGER, created_at INTEGER NOT NULL);-- relais_finances.dbCREATE TABLE financial_accounts ( id TEXT PRIMARY KEY, service_name TEXT NOT NULL, urgency_level TEXT DEFAULT 'immediate', content_enc BLOB NOT NULL, updated_at INTEGER NOT NULL) |

| 7 — Navigation & Sécurité UIGuards, comportements de sécurité, masquage. |

## 7.1 Guards de navigation
| export default function RootLayout() { const { isAuthenticated } = useSession() const { isUnlocked } = useKeyStore() const segments = useSegments() useEffect(() => { const inAuth = segments[0] === '(auth)' const inRelay = segments[0] === 'relay' if (!isAuthenticated && !inAuth && !inRelay) return router.replace('/login') if (isAuthenticated && !isUnlocked && !inAuth) return router.replace('/unlock') // Demande PIN if (isAuthenticated && inAuth) return router.replace('/dashboard') }, [isAuthenticated, isUnlocked, segments])} |

## 7.2 Comportements de sécurité
| Événement | Comportement |
| App passe en arrière-plan | Overlay opaque immédiat — cache contenu dans app switcher |
| Arrière-plan > 10min | KeyStore.clear() + fermeture des bases SQLite |
| Retour au premier plan | Demande PIN ou biométrie si KeyStore vide |
| Screenshot (Android) | Écran bloqué sur pages avec données sensibles |
| Inactivité > 3 mois | Déconnexion complète au prochain foreground |
| 5 échecs PIN | Blocage 30min + KeyStore.clear() + master_key inaccessible |

## 7.3 Sync offline
| // Write local immédiat, sync en arrière-planconst pendingSync: Set<Category> = new Set()// Après chaque write :pendingSync.add(category)// Au retour de connectivité :NetInfo.addEventListener(state => { if (state.isConnected) { for (const cat of pendingSync) { syncToStorj(cat).then(() => pendingSync.delete(cat)) } }}) |

— Fin des Frontend Specs v1.0 —
Prochaine étape : Schéma PostgreSQL


---

# Patchs DEC-28 / DEC-29 / DEC-30 (docx courant, avril 2026)

RELAIS
Passe le relais, pas le chaos.
Frontend Specs — Patch v1.2
Patch DEC-28/29 — crypto_box_seal pour notification_enc, signature Si_enc.
Avril 2026 — Confidentiel
# Sections modifiées
| Section | Changement |
| §5.2 Crypto — chiffrement | crypto_box_seal remplace XChaCha20(relais_public_key) (DEC-28) |
| §5.5 Activation transmission | Signature Ed25519 sur chaque Si_enc ajoutée (DEC-29) |

# §5.2 — crypto_box_seal pour notification_enc [DEC-28]
| XChaCha20(relais_public_key) était incorrect — XChaCha20 est symétrique. crypto_box_seal de libsodium est le bon primitif : ECDH éphémère X25519 + XChaCha20-Poly1305. |

| // src/crypto/vault.ts — chiffrement notification contact// 1. Récupérer la clé publique Relais (mise en cache)const { relais_x25519_pk } = await api.get('/transmission/relais-key')const pkBytes = base64ToBuffer(relais_x25519_pk)// 2. Chiffrer avec crypto_box_sealconst sodium = getSodium()const plaintext = new TextEncoder().encode( JSON.stringify({ email: contactEmail, phone: contactPhone }))const notification_enc = sodium.crypto_box_seal(plaintext, pkBytes)// → libsodium génère une paire éphémère en interne// → ECDH avec relais_x25519_pk// → XChaCha20-Poly1305// → Retourne ephemeral_pk || ciphertext// 3. Signer pour intégrité (inchangé)const { sk } = await deriveEd25519(seed)const notification_sig = await ed.signAsync(notification_enc, sk)sk.fill(0) |

# §5.5 — Signature Ed25519 sur Si_enc à l'activation [DEC-29]
| Cohérent avec DEC-07 (signature vault). Un access token volé ne peut pas remplacer une part Shamir sans la clé ed25519_sk dérivée du seed. |

| // src/crypto/shamir.ts — activation transmissionasync function encryptAndSignShare( share: Buffer, responses: string[], seed: Uint8Array): Promise<{ Si_enc: Uint8Array, hash: string, signature: Uint8Array }> { // 1. Chiffrer la part avec K_i (réponses du contact) const K_i = await deriveKey( Buffer.from(responses.join('|')), 'relais_contact_v1' ) const Si_enc = encrypt(share, K_i) K_i.fill(0) // 2. Signer SHA256(Si_enc) avec ed25519_sk (DEC-29) const hash = sha256(Si_enc) // Uint8Array const hashHex = bufferToHex(hash) const { sk } = await deriveEd25519(seed) const signature = await ed.signAsync(hash, sk) sk.fill(0) return { Si_enc, hash: hashHex, signature }}// Utilisation dans le flow d'activationconst shares = shamir.split(K, { shares: M, threshold: N })for (let i = 0; i < contacts.length; i++) { const { Si_enc, hash, signature } = await encryptAndSignShare( shares[i], contacts[i].responses, seed ) // Push Si_enc sur Storj const storj_path = await storj.upload(userId, `shares/${contactId}`, Si_enc) // Inclure dans le payload POST /transmission/activate payload.contacts[i] = { ...payload.contacts[i], storj_path, share_hash: hash, share_sig: bufferToBase64(signature) // ← DEC-29 }} |

— Fin du patch Frontend Specs DEC-28/29
