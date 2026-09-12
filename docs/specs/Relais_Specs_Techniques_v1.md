RELAIS
Passe le relais, pas le chaos.
Specs Techniques — Version 1.3
v1.3 — Corrections B.3, D.2, D.3, Shamir 33 bytes, secret_enc complet, signature vault.
Avril 2026 — Confidentiel
# Changelog
| Version | Changements |
| v1.0 | Document initial — 6 sections |
| v1.1 | DEC-01 à DEC-19 : seed_enc_pin permanent, PIN seul, Ed25519, Arbitrum, trusted contacts deux niveaux, HCV Transit retiré |
| v1.2 | DEC-20 : questions = FK checkin_questions (secret_enc sans questions). DEC-26 : backoff PIN. DEC-27 : POST /auth/seed/display. DEC-28 : crypto_box_seal. DEC-29 : signature Si_enc. DEC-31 : signature carnet. |

# 1. Vocabulaire
| Terme | Définition v1.2 |
| D | Données brutes saisies (login, mdp, instructions). En clair en mémoire vive uniquement. |
| K1 / K2 / K3 | Clés symétriques 256 bits. Dérivées du seed via Argon2id avec ctx distinct. Jamais stockées. |
| P1 | D chiffré avec Ki via XChaCha20-Poly1305. Stocké dans SQLite local. |
| P2 | P1 rechiffré avec Ki. Stocké sur Storj. v1.2 : XChaCha20 seul — HCV Transit retiré (DEC-16). |
| S1...SM | Parts Shamir de Ki. 32 bytes bruts. M parts créées, N suffisent pour reconstituer K. |
| K_i | Clé éphémère dérivée des réponses du Contact i via Argon2id. Jamais stockée. |
| Si_enc | Si chiffré avec K_i + signé Ed25519 (DEC-29). Stocké sur Storj. Hash on-chain Arbitrum. |
| ed25519_pk | Clé publique Ed25519 dérivée du seed. Stockée PostgreSQL + Arbitrum. Vérifie les signatures. |
| ed25519_sk | Clé privée Ed25519 dérivée à la demande. Jamais stockée. Signe vault, Si_enc, carnet, challenges. |
| seed_enc_pin | Seed chiffré Argon2id(PIN). SecureStore PERMANENT — jamais supprimé (DEC-01). |
| notification_enc | crypto_box_seal({email,phone}, relais_x25519_pk). Relais peut lire pour notifier (DEC-28). |
| notification_sig | Ed25519.sign(notification_enc, owner_sk). Protège contre modification par Relais. |
| secret_enc | v1.2 : {nom, rôle, message_personnel} chiffré K2. Relais ne peut pas lire. Les questions sont dans question_1/2/3_id (DEC-20). |
| verify_token | XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1'). Permet vérification annuelle des réponses. |
| relais_x25519_pk | Clé publique X25519 Relais. Exposée via GET /transmission/relais-key. |
| relais_x25519_sk | Clé privée X25519 Relais. Dans HCV Secrets Engine (DEC-15). Déchiffre notification_enc. |
| HCV | HashiCorp Vault — Secrets Engine UNIQUEMENT. Stocke relais_x25519_sk. (HCV Transit retiré DEC-16) |

# 2. Algorithmes
| Algorithme | Rôle | Justification |
| BIP39 | Génération seed (12 mots) | Standard universel, mémorisable |
| Argon2id | Dérivation K1/K2/K3, PIN, K_i réponses | Résistant brute force, coûteux en mémoire |
| XChaCha20-Poly1305 | Chiffrement P1/P2, Si, notification (contact), journal | Confidentialité + intégrité, nonce 192 bits |
| Shamir N-of-M | Découpe K en parts Si | Aucune part seule ne révèle K |
| Ed25519 | Signature vault, Si_enc, carnet, challenge restauration | Dérivé du seed, rapide, vérifiable |
| crypto_box_seal | Chiffrement notification_enc (DEC-28) | ECDH éphémère X25519 + XChaCha20-Poly1305 |
| SHA256 | Hash avant signature Ed25519 | Preuve d'intégrité |
| Arbitrum L2 | Smart contract DMS | Autonome, hérite sécurité Ethereum |

# 3. Architecture de stockage
| v1.2 : P2 = XChaCha20(Ki, P1) uniquement (HCV Transit retiré DEC-16). notification_enc = crypto_box_seal (DEC-28). secret_enc sans questions (DEC-20). Si_enc sur Storj avec signature (DEC-29). |

| Donnée | Chiffrement | Où | Qui peut lire |
| D | — | Mémoire vive uniquement | Owner (session active) |
| K1, K2, K3 | — | Mémoire vive uniquement | Owner (session active) |
| P1 | Ki + XChaCha20 | SQLite local | Owner (Ki depuis seed) |
| P2 | Ki + XChaCha20 | Storj | Owner (Ki depuis seed) |
| Si_enc (parts Shamir) | K_i + XChaCha20 | Storj | Contact i (réponses) |
| Hash(Si_enc) | — | Arbitrum (public) | Tous — preuve intégrité |
| notification_enc | crypto_box_seal(relais_x25519_pk) | PostgreSQL | Relais (pour notifier) |
| notification_sig | Ed25519.sign(notif_enc, owner_sk) | PostgreSQL | Vérifiable par tous |
| secret_enc | XChaCha20(K2_owner) | PostgreSQL | Owner uniquement |
| verify_token | XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1') | PostgreSQL | Owner (vérif annuelle) |
| seed_enc_pin | Argon2id(PIN) | expo-secure-store | Owner (PIN local) |
| ed25519_pk | — | PostgreSQL + Arbitrum | Public |
| Config DMS, last_checkin | — | Arbitrum | Public (smart contract) |
| relais_x25519_pk | — | Endpoint public | Tous |
| relais_x25519_sk | HCV Secrets Engine | HCV | Relais backend |

# 4. Schéma Shamir N-of-M
| Schéma | M contacts | N requis |
| 2-of-2 | 2 | 2 (les deux) |
| 2-of-3 | 3 | 2 (n'importe lesquels) |
| 3-of-5 | 5 | 3 (n'importe lesquels) |

| K1 → Shamir N-of-M → S1_1...S1_MK2 → Shamir N-of-M → S2_1...S2_MK3 → Shamir N-of-M → S3_1...S3_MPour chaque contact_i et catégorie j :K_i = Argon2id(réponses_contact_i)Sj_enc = XChaCha20(K_i, Sj_i)hash = SHA256(Sj_enc)sig = Ed25519.sign(hash, owner_sk) ← DEC-29K_i détruite immédiatementSj_enc → Storj | hash → Arbitrum | sig → PostgreSQL |

# 5. Cycles de vie
## 5.1 Création du compte
| App génère 12 mots BIP39 — affichés UNE seule fois — JAMAIS stockésseed + ctx='relais_comptes_v1' → K1seed + ctx='relais_messages_v1' → K2seed + ctx='relais_finances_v1' → K3seed → Ed25519.keypair() → { ed25519_sk, ed25519_pk }ed25519_pk → PostgreSQL + Arbitrum// seed_enc_pin PERMANENT (DEC-01)pin_key = Argon2id(PIN)seed_enc_pin = XChaCha20(pin_key, seed)SecureStore.set('seed_enc_pin', ...) ← jamais supprimé// Backup initialP2_i = XChaCha20(Ki, P1_i)hash = SHA256(P1_i)sig = Ed25519.sign(hash, ed25519_sk)POST /vault/sync { payload: P2_i, signature }Serveur vérifie signature avant stockage Storj |

## 5.2 Saisie et chiffrement local
| D = { service, login, mdp, instructions } ← mémoire vive uniquementXChaCha20(Ki, D) → P1_i → SQLite localD en clair détruit immédiatement// Sync Storj (debounced 3s)P2_i = XChaCha20(Ki, P1_i) ← Ki seule (DEC-16)sig = Ed25519.sign(SHA256(P1_i), ed25519_sk)POST /vault/sync { category, payload: P2_i, signature } |

## 5.3 Activation de la transmission
| // Niveau 1 — notification_enc (DEC-28)relais_x25519_pk = GET /transmission/relais-keynotification_enc = crypto_box_seal({email,phone}, relais_x25519_pk)notification_sig = Ed25519.sign(notification_enc, owner_sk)// Niveau 2 — secret_enc (DEC-20 : sans les questions)secret_enc = XChaCha20(K2, {nom, rôle, message_personnel})// Questions = FK vers bibliothèque publique (DEC-20)question_1/2/3_id = UUID références vers checkin_questions// Parts Shamir + signatures (DEC-29)for each contact_i: K_i = Argon2id(réponses_contact_i) Si_enc = XChaCha20(K_i, S_i) hash = SHA256(Si_enc) sig_i = Ed25519.sign(hash, ed25519_sk) K_i détruite immédiatement Si_enc → Storj | hash → Arbitrum | sig_i → PostgreSQL// Verify tokenverify_token = XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1')POST /transmission/activate { contacts: [...], signatures: [...] } |

## 5.4 Accès quotidien (pré-mortem)
| // Déverrouillage PINpin_key = Argon2id(PIN)seed = XChaCha20_decrypt(pin_key, seed_enc_pin)K1,K2,K3 = Argon2id(seed, ctx_i)seed.fill(0)// Lecture locale — aucun appel réseauXChaCha20_decrypt(Ki, P1_i) → D (mémoire vive)// À la fermeture / arrière-plan > 10minK1, K2, K3 → détruites | D → détruitseed_enc_pin → toujours dans SecureStore ✅ |

## 5.5 Restauration — nouveau device
| // seed_enc_pin absent → login mdp → tokensGET /auth/restore/challenge → { challenge: 32 bytes }seed_saisi = BIP39.toBytes(12_mots)ed25519_sk = Ed25519.keypair(seed_saisi).sksig = Ed25519.sign(challenge, ed25519_sk)ed25519_sk.fill(0)POST /auth/restore/verify { signature } → OK ou KO// Si valideseed_enc_pin = XChaCha20(Argon2id(PIN), seed_saisi) → SecureStore PERMANENTK1,K2,K3 = Argon2id(seed_saisi, ctx_i)Télécharge P2_i depuis Storj → XChaCha20_decrypt(Ki, P2_i) → P1_i → SQLite ✅ |

## 5.6 Reconstitution post-mortem
| // DEC-35 : déclenchement quand 3 relances ET silence_duration_months écoulé// Chaque contact reçoit lien avec relay_tokenGET /relay/:token → { questions: [{id, text_fr, text_en}], roles } ← texte public DEC-20Contact saisit réponsesK_i = Argon2id(réponses)App télécharge Si_enc depuis StorjXChaCha20_decrypt(K_i, Si_enc) → Si (Poly1305 = réponses correctes ✅)Si re-chiffré clé session Redis → escrow PostgreSQL (TTL 72h)// Quand N contacts ont réponduS1...SN → Shamir → K reconstituée ✅Escrow vidé immédiatement// Téléchargement + déchiffrement finalP2_j depuis Storj → XChaCha20_decrypt(Kj, P2_j) → D (mémoire vive device contact)P2 supprimé de Storj | Si_enc supprimés | K détruite |

# 6. Carnet de vie — check-in (DEC-31 à DEC-34)
## 6.1 Écritures du carnet signées Ed25519 (DEC-31)
| // POST /journal/entriescontent_enc = XChaCha20(K2, {question_id, mois, mode, texte})sig = Ed25519.sign(SHA256(content_enc), ed25519_sk)Body: { content_enc, signature, entry_month, mode, word_count_approx }// PUT /journal/entries/:id — même flow avec nouveau content_enc + sig// DELETE /journal/entries/:idsig = Ed25519.sign(SHA256(uuidToBytes(entry_id)), ed25519_sk)Body: { signature }// Un access token volé ne peut ni altérer ni effacer la capsule temps ✅ |

## 6.2 Wrapped annuel (DEC-32)
| // POST /journal/wrapped/:yearentry_count = COUNT(*) FROM journal_entries WHERE user_id=$1 AND year=$2if entry_count < 6 → 409 WRAPPED_INSUFFICIENT_ENTRIESstats_enc = XChaCha20(K2, stats_calculées_localement)sig = Ed25519.sign(SHA256(stats_enc), ed25519_sk)Body: { stats_enc, signature }INSERT annual_wrappeds { stats_enc, entry_count /* recalculé serveur */, year } |

## 6.3 Check-in et streak (DEC-33, DEC-34)
| // DEC-33 : mini-jeu fourni et vérifié côté serveurGET /checkin/game → { question, game_token } // JWT TTL 10minPOST /checkin/game/answer { game_token, answer } → checkin_token si correctPOST /checkin/complete { checkin_token, journal_entry_id? }// DEC-34 : streak = mois calendaires consécutifs// Badges : first_checkin | streak_3 | streak_6 | streak_12// DEC-35 : timing relances et déclenchement// Relances J+7, J+14, J+21 depuis next_checkin_due// Déclenchement : 3 relances ET silence_duration_months écoulé |

# 7. Sécurité du compte
## 7.1 Authentification
| Niveau | Mécanisme |
| 1 | Biométrie (Face ID / empreinte) |
| 2 (fallback) | PIN 6 chiffres → déchiffre seed_enc_pin → K1/K2/K3 |
| 3 (critique) | Mot de passe + PIN (nouveau device, inactivité) |

## 7.2 Blocage PIN — backoff progressif (DEC-26)
| Tentatives | Blocage |
| 1-5 | Libre |
| 6 | 30 secondes |
| 7 | 2 minutes |
| 8 | 10 minutes |
| 9+ | 30 minutes |

Implémenté 100% côté client. Configurable : security.pin_backoff_steps = '[30,120,600,1800]'
## 7.3 Actions sensibles — step-up token (DEC-25)
| POST /auth/pin/step-up { action: StepUpAction }X-Step-Up-Token: <token> // header sur endpoints protégésActions : edit_transmission | activate_transmission | delete_transmission edit_contacts | change_password | view_seed | disable_2fa | admin_action// JWT TTL 5min, usage unique, jti blacklisté Redis après utilisation |

# 8. Garanties de sécurité
| Scénario | Résultat |
| Serveurs Relais piratés | P2 illisible sans Ki (jamais côté serveur). notification_enc illisible sans relais_x25519_sk. |
| Storj piraté | Fragments incomplets. P2 illisible sans Ki. |
| relais_x25519_sk compromise | Accès emails/téléphones contacts uniquement. Pas accès vault ni parts Shamir. |
| Contact malveillant seul | Sa part seule ne reconstitue pas K. N-1 parts manquantes. |
| Access token volé | Vault, Si_enc, carnet protégés par signatures Ed25519 (DEC-07/29/31). |
| Interception réseau | Tout toujours chiffré + TLS. D ne transite jamais en clair. |
| Brute force réponses | Argon2id rend chaque tentative coûteuse. |

# 9. Infrastructure
| Service | Rôle |
| PostgreSQL | Metadata, questions, notification/secret_enc, verify_token, escrow, logs |
| Storj | P2 (vault backup) + Si_enc (parts Shamir) |
| Arbitrum L2 | Smart contract DMS. ed25519_pk, Hash(Si_enc), config, last_checkin |
| HCV | Secrets Engine — relais_x25519_sk UNIQUEMENT |
| React Native + Expo | App mobile iOS + Android |
| Node.js + Fastify | API serveur Relais |
| libsodium | XChaCha20, Argon2id, Ed25519, Shamir, crypto_box_seal côté client |
| BullMQ + Redis | Jobs asynchrones + step-up tokens + escrow keys éphémères |

# Corrections v1.3
| Ref | Correction |
| Crypto | Shamir : 33 bytes (pas 32). libsodium-wrappers-sumo (pas @noble/ed25519). |
| D.2 | notification_enc inclut owner_display_name (60 chars max). secret_enc inclut aussi email + téléphone. |
| D.3 | share_kN_plain_hash + plain_sig à l'activation. Vérification relay AVANT escrow. |
| B.3/DEC-33 | Bibliothèque serveur intégrée, jeton opaque. checkin_questions n'a pas d'answer_hash. |
| Audit | Signature vault = SHA256(category + ts + P2). ts dans le body. Rejet si ts > 5min. |

## §1 Shamir : 33 bytes (pas 32)
| L'implémentation maison GF(256) ajoute un byte de header. Toutes les références à '32 bytes bruts' dans les specs précédentes sont incorrectes. |

| // Part Shamir = 33 bytes (1 byte header GF256 + 32 bytes donnée)// Si_enc = XChaCha20(K_i, S_i) où S_i fait 33 bytes// share_kN_plain_hash = SHA256(S_i de 33 bytes) |

## §4.3 notification_enc + secret_enc (D.2)
| // notification_enc (D.2 : owner_display_name ajouté)notification_enc = crypto_box_seal({ email, phone, owner_display_name: ownerName.slice(0,60) // optionnel}, relais_x25519_pk)// secret_enc (v1.3 : inclut aussi email + téléphone)// L'owner peut voir les coordonnées de son contact sur son devicesecret_enc = XChaCha20(K2, { nom, rôle, message_personnel, email, telephone // copies pour lecture device owner // questions dans question_1/2/3_id (DEC-20)})// D.3 : plain_hash à l'activationshare_kN_plain_hash = SHA256(S_i) // 33 bytesshare_kN_plain_sig = Ed25519.sign(hash, owner_sk) |

## §5.2 Signature vault avec ts (audit sécurité)
| // Avant : signature = Ed25519.sign(SHA256(P2), sk)// Après (v1.3) :ts = Date.now().toString()payload = concat(category_bytes, ts_bytes, P2)sig = Ed25519.sign(SHA256(payload), sk)// body : { category, ts, payload: base64(P2), signature }// Serveur rejette si |NOW() - ts| > 5 minutes |

## DEC-33 corrigé (B.3)
| // checkin_questions = bibliothèque questions secrètes — pas d'answer_hash// API utilise bibliothèque intégrée serveur (api/checkin/games.ts)// game_token = jeton opaque (réponse jamais transmise au client)// État de partie en Redis 24h |

— Fin des Specs Techniques v1.3
