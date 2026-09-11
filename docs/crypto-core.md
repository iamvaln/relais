# RELAIS — Cœur crypto de l'app : notes d'implémentation

**Specs de référence** : Specs Techniques v1.2 §1–§6, Frontend Specs v1.1
§2, §4–§6, Journal des Décisions DEC-01 à DEC-07, DEC-12/13/20/28/29/31,
Proposal-8. Décisions du 11 septembre 2026 en §3.

`packages/crypto-core` est la partie de l'app mobile qui manipule des
secrets. Elle est écrite avant l'app, testée sous Node, et prouvée contre
la vraie API par un test de bout en bout (`apps/api/test/e2e-crypto-core.test.ts`).
Ni UI, ni stockage, ni réseau : des octets entrent, des octets sortent, et
chaque fonction efface ses copies de secrets (`wipe`).

## 1. Ce que fait chaque module

| Module | Rôle | Spec |
|---|---|---|
| `seed` | 12 mots BIP39 (EN ou FR, listes officielles), validation avec détection de langue, `seed` = 64 octets (PBKDF2, passphrase vide) | Techniques §2, §5.1 |
| `keys` | K1/K2/K3 = Argon2id(seed, ctx) ; paire Ed25519 = `crypto_sign_seed_keypair(seed[0:32])` ; `signPayload` = Ed25519 sur SHA256(payload), `signRaw` sur le message | DEC-05/06/07 |
| `aead` | Enveloppe XChaCha20-Poly1305 `[version 1][nonce 24][ciphertext+tag]`, données associées optionnelles | Techniques §2 |
| `pin` | `seed_enc_pin` = seal(Argon2id(PIN, sel aléatoire), seed) ; le sel accompagne le blob dans le SecureStore | DEC-01 à 04 |
| `vault` | P1 = seal(Ki, D), P2 = seal(Ki, P1), corps de `POST /vault/sync` signé sur SHA256(P2) ; `openBackup` pour la restauration | DEC-07/16 |
| `shamir` | N-of-M sur GF(2^8), polynôme AES 0x11b, parts de **33 octets** (index + 32) | Techniques §4 |
| `contacts` | K_i depuis les réponses, `verify_token`, sealed box de notification signée, `secret_enc`, part préparée (`enc`, `sig`, `plain_hash`, `plain_sig`) | DEC-12/20/28/29, Proposal-8 |
| `activation` | Corps complet de `POST /transmission/contacts` et `POST /transmission/activate` : découpe chaque Kj en N-of-|porteurs de kj|, la i-ème part au i-ème porteur | Techniques §5.3 |
| `relay` | Côté contact : réponses → K_i → vérification locale → parts déchiffrées ; puis N parts → Kj → P2 → D ; `openSecret` | Techniques §5.6, DEC-13 |
| `journal` | `content_enc` sous K2 et signatures DEC-31 (entrée, suppression sur l'id UTF-8, Wrapped) | DEC-31 |

## 2. Dépendances

- `libsodium-wrappers-sumo` — la build standard (celle de l'API) n'expose
  pas `crypto_pwhash` (Argon2id). Chargé par `src/sodium.ts` ; l'app mobile
  remplace ce module par `react-native-libsodium`, même surface.
- `@scure/bip39` — audité, listes de mots EN/FR, une seule dépendance
  transitive (`@noble/hashes`).
- Pas de `@noble/ed25519` (Frontend §2.3) : libsodium fait Ed25519.
- Pas de `secrets.js` : Shamir maison, 120 lignes, tests de propriété.

## 3. Décisions (11 septembre 2026)

| Point | Décision |
|---|---|
| Shamir | Implémentation maison GF(256). secrets.js n'est plus maintenu et travaille en hexadécimal. Parts de 33 octets : l'index est indispensable à la recombinaison et le contact ne reçoit que des octets. **L'API accepte 33 octets** (`relay/service.ts`, `SHARE_BYTES`). |
| Sel de K_i | `SHA256('relais_contact_v1\|q1\|q2\|q3')[0:16]` : public, stable, propre au contact, dérivable depuis `GET /relay/:token` (les `question_id` y sont). Aucune colonne, aucun changement d'API. |
| Argon2id | INTERACTIVE (64 Mo, ~0,1 s) pour K1/K2/K3 — le seed a 128 bits, le KDF n'ajoute rien ; MODERATE (256 Mo, ~1,5 s sous WASM) pour le PIN et les réponses, où le coût est la seule défense. |
| Réponses | Même normalisation que le check-in : NFD sans accents, minuscules, `œ` → `oe`, ponctuation → espace, espaces réduits. Appliquée à l'activation et au relay. |
| Ed25519 | `seed[0:32]` comme graine (Frontend §2.3), via libsodium. |
| seed | 64 octets BIP39 standard, passphrase vide, vecteur de test connu (`abandon … about`). |
| Enveloppe | 1 octet de version en tête de chaque blob chiffré pour pouvoir changer d'algorithme sans ambiguïté. |
| Rôles et N | Une catégorie n'est déverrouillable que si N contacts la portent : `buildActivationBody` refuse un rôle porté par moins de N contacts. |

## 4. Ce que l'app mobile doit encore brancher

- `expo-secure-store` : `seed_enc_pin` + `salt` (permanents, DEC-01).
- SQLite chiffré : P1 par catégorie ; `encryptLocal` / `decryptLocal`.
- Client HTTP : les corps sont produits tels quels (`buildSyncPayload`,
  `buildContactBody`, `buildActivationBody`, `answerRelay`, `buildEntryPayload`).
- Backoff PIN (DEC-26) et destruction de K1/K2/K3 à l'arrière-plan
  (Frontend §2.1) : côté app, pas côté cœur.
- Arbitrum : rien (contrat reporté).

## 5. Vérifications

32 tests unitaires (`packages/crypto-core/test`) : vecteur BIP39 connu,
détection de langue, tables GF(256) (FIPS-197), toute combinaison de N parts
recombine et N−1 ne donnent rien, altération / mauvaise clé / mauvaise
version d'enveloppe refusées, PIN faux refusé, normalisation des réponses,
sealed box ouverte avec la clé de Relais, signatures vérifiées par libsodium
sur le hash — la convention de l'API.

Un test de bout en bout contre l'API réelle : inscription, clé publique,
challenge de restauration signé depuis les 12 mots, coffre synchronisé puis
restauré, deux contacts créés et activation 2-of-2 signée, vérification
annuelle (locale puis attestation), déclenchement, mauvaises réponses
détectées sur le device, parts déposées, catégories déverrouillées,
reconstitution de K1 et lecture de D par le contact, `secret_enc` lu via K2,
entrée de carnet signée puis supprimée. Le serveur n'a vu aucun clair :
le test vérifie que P2 ne contient pas les données.
