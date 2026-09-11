RELAIS
Passe le relais, pas le chaos.
Journal des Décisions Architecture — Version 1.0 + Addendums v1.1/v1.2/v1.3
Version complète — DEC-01 à DEC-35
Avril 2026 — Confidentiel
# Index des décisions
| DEC | Titre | Addendum |
| 01 | seed_enc_pin — stockage permanent | v1.0 |
| 02 | PIN seul pour chiffrer le seed | v1.0 |
| 03 | Comportement inactivité corrigé | v1.0 |
| 04 | Nouveau device — flow corrigé | v1.0 |
| 05 | Ed25519 keypair dérivé du seed | v1.0 |
| 06 | Challenge-response Ed25519 restauration | v1.0 |
| 07 | Signature des syncs vault | v1.0 |
| 08 | Arbitrum L2 — pas Ethereum mainnet | v1.0 |
| 09 | Dead man's switch = smart contract Arbitrum | v1.0 |
| 10 | Ce qui va on-chain vs off-chain | v1.0 |
| 11 | Migration blockchain future | v1.0 |
| 12 | Deux niveaux de données trusted contacts | v1.0 |
| 13 | Vérification réponses = 100% côté client | v1.0 |
| 14 | Transmission = transport aveugle | v1.0 |
| 15 | relais_private_key dans HCV | v1.0 |
| 16 | HCV retiré du chiffrement données utilisateur | v1.0 |
| 17 | HCV réduit à un seul usage | v1.0 |
| 18 | Secrets infra = variables d'environnement | v1.0 |
| 19 | Signature des syncs vault (Ed25519) | v1.0 |
| 20 | Questions = FK vers checkin_questions | v1.1 |
| 21 | Vault purement local — pas de table vault | v1.1 |
| 22 | silence_duration_months DEFAULT 3 | v1.1 |
| 23 | Data recipient externe supprimé | v1.1 |
| 24 | email_log + payment_events | v1.1 |
| 25 | Step-up token canonique | v1.1 |
| 26 | PIN backoff progressif | v1.1 |
| 27 | POST /auth/seed/display | v1.1 |
| 28 | notification_enc = crypto_box_seal X25519 | v1.2 |
| 29 | Si_enc signés Ed25519 à l'activation | v1.2 |
| 30 | Email activation via abstraction secrets | v1.2 |
| 31 | Écritures carnet signées Ed25519 | v1.3 |
| 32 | Wrapped : seuil 6 vérifié serveur | v1.3 |
| 33 | Check-in : mini-jeu fourni et vérifié serveur | v1.3 |
| 34 | Streak = mois calendaires, 4 badges | v1.3 |
| 35 | Timing relances + déclenchement corrigé | v1.3 |

# A. Cryptographie côté client (DEC-01 à DEC-07)
| DEC-01  seed_enc_pin — stockage permanent du seed Impact : Frontend Specs section 3 |

| seed_enc_pin n'est JAMAIS supprimé. Même après inactivité prolongée. Supprimer le seed chiffré créerait le pire scénario : données inaccessibles si 12 mots perdus. |

| seed_enc_pin = XChaCha20(Argon2id(PIN), seed) → SecureStore PERMANENT — jamais supprimé → Pas de master_key intermédiaire |

| DEC-02  PIN seul pour chiffrer le seed — mot de passe = auth serveur uniquement Impact : Frontend Specs section 3 |

| Élément | Rôle | Jamais utilisé pour |
| Mot de passe | Auth serveur | Crypto locale |
| PIN | Chiffrer seed sur le device | Auth serveur |
| Seed | Source de K1/K2/K3 + Ed25519 | Auth serveur |

| DEC-03  Comportement inactivité > 3 mois corrigé Impact : Frontend Specs section 2-3 |

| // seed_enc_pin toujours présent après 3 mois // Login mot de passe → tokens → app demande PIN // PIN déchiffre seed_enc_pin → K1/K2/K3 ✅ // Pas de 12 mots requis — pas de suppression de données |

| DEC-04  Nouveau device — flow corrigé Impact : Frontend Specs section 3 |

| // seed_enc_pin absent (nouveau device / réinstallation) 1. Login mot de passe → auth serveur → tokens 2. App détecte : seed_enc_pin absent 3. 'Créez votre PIN pour ce téléphone' 4. 'Entrez vos 12 mots pour restaurer votre coffre' 5. seed_enc_pin = XChaCha20(Argon2id(PIN), seed) → SecureStore PERMANENT |

| DEC-05  Ed25519 keypair dérivé du seed Impact : Frontend Specs section 5, Backend Specs section 2 |

| seed + ctx='relais_comptes_v1'   → Argon2id → K1 seed + ctx='relais_messages_v1'  → Argon2id → K2 seed + ctx='relais_finances_v1'  → Argon2id → K3 seed → Ed25519.keypair()         → { ed25519_sk, ed25519_pk } ed25519_pk → PostgreSQL + Arbitrum (public, immuable) ed25519_sk → dérivé à la demande, JAMAIS stocké |

| DEC-06  Challenge-response Ed25519 pour restauration Impact : Backend Specs section 3, Frontend Specs section 3 |

| GET  /auth/restore/challenge → { challenge: 32 bytes aléatoires } seed_saisi → ed25519_sk = Ed25519.keypair(seed).sk signature  = Ed25519.sign(challenge, sk) POST /auth/restore/verify { signature } → Serveur : Ed25519.verify(signature, challenge, ed25519_pk) // Le seed ne transite jamais sur le réseau ✅ |

| DEC-07  Signature des syncs vault Impact : Backend Specs section 3, Frontend Specs section 7 |

| hash      = SHA256(P1) signature = Ed25519.sign(hash, ed25519_sk) POST /vault/sync { category, payload: P1, signature } → Serveur vérifie avec ed25519_pk avant stockage Storj // Un access token volé ne peut pas modifier le vault ✅ |

# B. Architecture blockchain (DEC-08 à DEC-11)
| DEC-08  Arbitrum L2 — pas Ethereum mainnet Impact : Backend Specs, Specs Techniques |

| Critère | Ethereum L1 | Arbitrum L2 |
| Frais | $5-100+ | ~$0.005-0.15 |
| Sécurité | Maximum | Héritée Ethereum |
| EVM | Native | Complète |
| Finalité | ~13min | Soft 1-2s / Hard ~13min |

| DEC-09  Dead man's switch = smart contract Arbitrum Impact : Backend Specs section 4 |

| contract RelaisDeadManSwitch { mapping(address => uint256) public lastCheckin; mapping(address => DmsConfig) public config;  function checkin() external { lastCheckin[msg.sender] = block.timestamp; } function isTriggered(address owner) public view returns (bool) { return block.timestamp > lastCheckin[owner] + config[owner].silenceDuration; } } |

| DEC-10  Ce qui va on-chain vs off-chain Impact : Specs Techniques |

| Donnée | Où |
| ed25519_pk | Arbitrum |
| Hash(Si_enc) | Arbitrum |
| Hash(notification_enc+sig) | Arbitrum |
| Config DMS, last_checkin | Arbitrum |
| P2 vault | Storj |
| Si_enc | Storj |
| notification_enc | PostgreSQL |
| secret_enc | PostgreSQL |

| DEC-11  Migration blockchain future Impact : Specs Techniques |

Ed25519/secp256k1 standards — même clé fonctionne sur Arbitrum, Base, Polygon
Events comme source de vérité — state reconstituable
Données utilisateur indépendantes de la chain choisie
# C. Trusted contacts (DEC-12 à DEC-15)
| DEC-12  Deux niveaux de données par contact Impact : Specs Techniques, Backend Specs |

| NIVEAU 1 — notification_enc (Relais peut lire pour notifier) → crypto_box_seal({email,phone}, relais_x25519_pk)  -- DEC-28 → Signé Ed25519 owner  -- DEC-29  NIVEAU 2 — secret_enc (Relais ne peut PAS lire) → XChaCha20(K2, {nom, rôle, message_personnel}) |

| DEC-13  Vérification réponses = 100% côté client Impact : Frontend Specs |

| Contact saisit réponses → K_i = Argon2id(réponses) App télécharge Si_enc depuis Storj XChaCha20_decrypt(K_i, Si_enc) → Si  (Poly1305 succès = OK ✅) // Relais ne vérifie rien — transporte seulement |

| DEC-14  Transmission = transport aveugle Impact : Specs Techniques |

Messages chiffrés K2 → Relais ne peut pas lire
Parts Shamir chiffrées K_i → Relais ne peut pas lire
Relais = facteur aveugle qui livre des enveloppes fermées
| DEC-15  relais_x25519_sk dans HCV Secrets Engine Impact : Backend Specs section 5 |

| // HCV Secrets Engine — UN SEUL usage relais/x25519_sk  → clé privée X25519 pour crypto_box_seal_open → notifie les contacts en déchiffrant notification_enc |

# D. Simplification HCV (DEC-16 à DEC-19)
| DEC-16  HCV Transit retiré du chiffrement données Impact : Backend Specs, Specs Techniques |

| P2 = XChaCha20(Ki, P1) uniquement. Relais ne peut pas déchiffrer le vault. Architecture vraiment non-custodiale. |

| Donnée | Avant | Après |
| P2 (vault) | K + HCV Transit | Ki uniquement |
| Si_enc | Envisagé HCV | K_i uniquement (côté client) |
| Responsabilité HCV | Chiffrement + secrets | Secrets uniquement |

| DEC-17  HCV réduit à un seul usage Impact : Backend Specs section 5 |

| // HCV Secrets Engine : relais/x25519_sk UNIQUEMENT |

| DEC-18  Secrets infra = variables d'environnement hébergeur Impact : Backend Specs section 8 |

| Secret | Stockage |
| relais/x25519_sk | HCV Secrets Engine |
| DATABASE_URL | Env var hébergeur |
| JWT_ACCESS_SECRET | Env var hébergeur |
| STORJ_ACCESS_KEY | Env var hébergeur |
| RESEND_API_KEY | Env var hébergeur |

| DEC-19  Signature syncs vault — résumé Impact : Cohérent DEC-07 |

ed25519_sk signe SHA256(P1) avant chaque sync
Serveur vérifie avec ed25519_pk avant d'accepter
Garantit que seul le vrai owner peut modifier son backup
# E. Addendum v1.1 — DEC-20 à DEC-27
| DEC-20  Questions = FK vers checkin_questions Impact : Specs Techniques §4.3, Backend Specs §3.7, Schema trusted_contacts |

| Problème résolu : secret_enc chiffré K2 (owner décédé) — le contact ne pouvait pas lire ses questions. Solution : texte public depuis bibliothèque admin via /relay/:token. |

| // trusted_contacts question_1_id  UUID  NOT NULL REFERENCES checkin_questions(id) question_2_id  UUID  NOT NULL REFERENCES checkin_questions(id) question_3_id  UUID  NOT NULL REFERENCES checkin_questions(id)  // secret_enc = { nom, rôle, message_personnel } UNIQUEMENT — plus de questions |

| DEC-21  Vault purement local — pas de table vault en PostgreSQL Impact : Backend Specs §3.3 |

| // Supprimés : GET/POST/PUT/DELETE /vault/accounts, GET /vault/summary // Conservés  : POST /vault/sync, POST /vault/restore, GET /vault/sync-status // free_max_accounts = 5 → contrainte côté client uniquement (SQLite local) |

| DEC-22  silence_duration_months DEFAULT 3 Impact : Schema transmission_configs |

Aligné sur session_months = 3 mois (Specs Techniques §7.3)
3 mois d'inactivité déclenchent simultanément déconnexion et premières relances
| DEC-23  Data recipient externe supprimé Impact : User Stories E3-US04 |

| // Personne sans part Shamir ne peut pas déchiffrer sans que Relais voie le clair // → contradiction avec DEC-14 (transport aveugle) // Destinataire = TOUJOURS un trusted_contact avec rôle |

| DEC-24  email_log + payment_events ajoutées Impact : Schema tables 21-22 |

email_log : traçabilité délivrance pour support BO-02 (OTP non reçus)
payment_events : historique facturation pour MRR/ARR BO-07
| DEC-25  Step-up token canonique Impact : Backend Specs §2.5 |

| POST /auth/pin/step-up X-Step-Up-Token: <token> Actions : edit_transmission | activate_transmission | delete_transmission edit_contacts | change_password | view_seed | disable_2fa | admin_action |

| DEC-26  PIN backoff progressif Impact : Specs Techniques §8.2, app_config |

| Tentative | Durée blocage |
| 1-5 | Libre |
| 6 | 30 secondes |
| 7 | 2 minutes |
| 8 | 10 minutes |
| 9+ | 30 minutes |

Configurable : security.pin_backoff_steps = '[30,120,600,1800]'
| DEC-27  POST /auth/seed/display — pas GET /auth/seed-words Impact : Backend Specs §3.1 |

| // Le serveur n'a jamais le seed — il retourne { authorized: true } // L'app déchiffre seed_enc_pin localement et affiche les 12 mots // POST car action délibérée + step-up 'view_seed' requis |

# F. Addendum v1.2 — DEC-28 à DEC-30
| DEC-28  notification_enc = crypto_box_seal X25519 Impact : Specs Techniques §1,§4.3, Backend Specs §3.1, Frontend Specs §5 |

| ERREUR corrigée : XChaCha20(relais_public_key) était incorrect — XChaCha20 est symétrique. La primitive correcte est crypto_box_seal (ECDH éphémère X25519 + XChaCha20-Poly1305). |

| // AVANT (incorrect) notification_enc = XChaCha20(relais_public_key, { email, phone })  // APRÈS (DEC-28) notification_enc = crypto_box_seal({ email, phone }, relais_x25519_pk)  // Nouveau endpoint GET /transmission/relais-key → { relais_x25519_pk: base64 }  (public, pas d'auth) |

| DEC-29  Si_enc signés Ed25519 à l'activation Impact : Specs Techniques §4.3, Backend Specs §3.4 |

| // Cohérent avec DEC-07 (vault) — même primitive, même garantie Si_enc = XChaCha20(K_i, S_i) hash_i  = SHA256(Si_enc) sig_i   = Ed25519.sign(hash_i, ed25519_sk) // Serveur vérifie avant stockage Storj // Un access token volé ne peut pas remplacer une part Shamir ✅ |

| DEC-30  Email activation contacts en direct via abstraction secrets Impact : Backend Specs §3.4 |

| // src/services/secrets.ts async function getRelaisX25519Sk(): Promise<Buffer> { if (process.env.NODE_ENV === 'production') return hcv.getSecret('relais/x25519_sk') return Buffer.from(process.env.RELAIS_X25519_SK_DEV!, 'hex') } // HCV en prod, env var en dev — le reste du code n'importe que secrets.* |

# G. Addendum v1.3 — DEC-31 à DEC-35
| DEC-31  Écritures du carnet signées Ed25519 Impact : Backend Specs §3.6, Frontend Specs §5 |

| // POST/PUT /journal/entries signature = Ed25519.sign(SHA256(content_enc), ed25519_sk) // DELETE /journal/entries/:id signature = Ed25519.sign(SHA256(uuidToBytes(id)), ed25519_sk) // POST /journal/wrapped/:year signature = Ed25519.sign(SHA256(stats_enc), ed25519_sk) // Un access token volé ne peut ni altérer ni effacer la capsule temps ✅ |

| DEC-32  Wrapped : seuil 6 vérifié serveur, entry_count recalculé Impact : Backend Specs §3.6 |

| // POST /journal/wrapped/:year entry_count = SELECT COUNT(*) FROM journal_entries WHERE user_id = $1 AND entry_month BETWEEN ':year-01-01' AND ':year-12-31'  if entry_count < 6 → 409 WRAPPED_INSUFFICIENT_ENTRIES { current, required: 6 }  INSERT annual_wrappeds { stats_enc, entry_count /* valeur serveur */, year } |

| DEC-33  Check-in : mini-jeu fourni et vérifié serveur Impact : Backend Specs §3.5 |

| GET /checkin/game → Serveur sélectionne énigme, génère game_token JWT (TTL 10min, usage unique) → Returns: { question_fr, question_en, game_type, game_token }  POST /checkin/game/answer { game_token, answer } → Vérifie token + compare SHA256(answer) → Si correct : émet checkin_token (TTL 15min, usage unique)  POST /checkin/complete { checkin_token, journal_entry_id? } → INSERT checkin_log, UPDATE next_checkin_due, relance_count = 0 |

| DEC-34  Streak = mois calendaires consécutifs, 4 badges Impact : Backend Specs §3.5 |

| // Calcul au POST /checkin/complete prev_month = date_trunc('month', NOW()) - INTERVAL '1 month' has_prev   = SELECT 1 FROM checkin_log WHERE user_id=$1 AND checkin_month=prev_month new_streak = has_prev ? current_streak + 1 : 1  // 4 badges 'first_checkin' si new_streak = 1 'streak_3'      si new_streak = 3 'streak_6'      si new_streak = 6 'streak_12'     si new_streak = 12 |

| DEC-35  Timing relances + déclenchement corrigé Impact : Backend Specs §4.2 |

| Correction : le pseudo-code §4.2 rendait silence_duration_months inopérant ('relance 3 + 21j → déclenchement'). La valeur du paramètre était ignorée. |

| // JOB deadman:checkin (quotidien) overdue_since     = NOW() - last_checkin_at silence_threshold = silence_duration_months * 30 jours days_overdue      = (NOW() - next_checkin_due).days  if relance_count=0 AND days_overdue>=7:  envoyer relance_1 if relance_count=1 AND days_overdue>=14: envoyer relance_2 if relance_count=2 AND days_overdue>=21: envoyer relance_3  // DEC-35 : déclenchement quand 3 relances ET silence_duration_months écoulé if relance_count=3 AND overdue_since >= silence_threshold: enqueue deadman:trigger  // Exemple silence_duration_months=3 (défaut) // last_checkin 1er janvier → relances 8/15/22 février → déclenchement 1er AVRIL |

## Errata User Stories
| US | Correction |
| E3-US04 | Supprimer 'data recipient externe (email uniquement)'. Destinataire = trusted contact avec rôle (DEC-23). |
| E1-US03 | Blocage PIN : backoff progressif [30s, 2min, 10min, 30min] — pas 30 secondes fixe (DEC-26). |
| E3-US05 | 'Bimestriel' → 'Bimensuel (toutes les 2 semaines)'. checkin_frequency_weeks IN (1,2,4) est correct. |

— Fin du Journal des Décisions Architecture — DEC-01 à DEC-35
