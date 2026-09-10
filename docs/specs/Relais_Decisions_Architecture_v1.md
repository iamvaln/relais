RELAIS
Journal des Décisions Architecture
Version 1.0 — Avril 2026
Confidentiel
# Introduction
Ce document trace les décisions architecturales prises lors des sessions de conception de Relais. Chaque décision inclut sa justification, son impact sur les specs, et les specs documents mis à jour.
| Domaine | Décisions | Documents impactés |
| Cryptographie client | DEC-01 à DEC-07 | Frontend Specs, Specs Techniques |
| Blockchain & L2 | DEC-08 à DEC-11 | Backend Specs, Specs Techniques |
| Trusted contacts | DEC-12 à DEC-15 | Specs Techniques, Backend Specs |
| Simplification HCV | DEC-16 à DEC-18 | Backend Specs, Frontend Specs |
| Intégrité vault | DEC-19 | Backend Specs, Frontend Specs |

# A. Cryptographie côté client
| DEC-01 seed_enc_pin — stockage permanent du seedImpact : Frontend Specs section 3 |

| Le seed chiffré avec le PIN est le seul fichier persisté contenant le seed. Il n'est JAMAIS supprimé, même après une longue inactivité. |

| // AVANT (incorrect)→ Suppression de seed_enc après 3 mois d'inactivité→ Master_key intermédiaire// APRÈS (correct)seed_enc_pin = XChaCha20(Argon2id(PIN), seed)→ Stocké dans expo-secure-store PERMANENTEMENT→ Jamais supprimé — même après inactivité longue→ Pas de master_key intermédiaire |

Justification
- Supprimer seed_enc crée le pire scénario — données inaccessibles si 12 mots perdus
- Expérience wallet crypto : oublier sa seed phrase est l'erreur la plus irréparable
- Le device perdu/volé est protégé par Argon2id(PIN) — brute force impossible
| DEC-02 PIN seul pour chiffrer le seed — pas de seed_enc_pwdImpact : Frontend Specs section 3 |

| Le mot de passe sert uniquement à l'authentification serveur. Il n'a aucun rôle cryptographique côté client. Le seed ne quitte JAMAIS le device. |

| Élément | Rôle | Jamais utilisé pour |
| Mot de passe | Auth serveur uniquement | Crypto locale |
| PIN | Chiffrer seed sur le device | Auth serveur |
| Seed | Source de K1/K2/K3 | Auth serveur |
| 12 mots | Restaurer seed sur nouveau device | Auth serveur |

| DEC-03 Comportement inactivité > 3 mois corrigéImpact : Frontend Specs section 2, 3 |

| // Inactivité > 3 moisseed_enc_pin → toujours présent dans SecureStoreBiométrie/PIN → refusés par l'OS (expiration système)// Login mot de passe → auth serveur → tokens// App détecte que seed_enc_pin existe// Demande PIN → déchiffre seed_enc_pin → K1/K2/K3 ✅// Pas de 12 mots requis// Pas de suppression de données |

| DEC-04 Nouveau device — flow corrigéImpact : Frontend Specs section 3 |

| // seed_enc_pin absent (nouveau device ou réinstallation)1. Login mot de passe → auth serveur → tokens2. App détecte : seed_enc_pin absent3. 'Créez votre PIN pour ce téléphone' → PIN différent de l'ancien device = normal4. 'Entrez vos 12 mots pour restaurer votre coffre' → seed = BIP39.toBytes(12_mots)5. seed_enc_pin = XChaCha20(Argon2id(nouveau_PIN), seed)6. SecureStore.set('seed_enc_pin', ...) ✅7. K1/K2/K3 dérivées → mémoire vive ✅ |

| DEC-05 Ed25519 keypair dérivé du seedImpact : Frontend Specs section 5, Backend Specs section 2 |

| seed (12 mots BIP39) → K1 = Argon2id(seed, ctx='relais_comptes_v1') → K2 = Argon2id(seed, ctx='relais_messages_v1') → K3 = Argon2id(seed, ctx='relais_finances_v1') → Ed25519.keypair(seed) → { ed25519_sk, ed25519_pk }ed25519_pk → stockée en PostgreSQL à l'inscription → adresse publique on-chain Arbitrumed25519_sk → dérivée à la demande, JAMAIS stockée → signe les syncs vault + challenge restauration |

| DEC-06 Challenge-response Ed25519 pour restaurationImpact : Backend Specs section 3, Frontend Specs section 3 |

| // Vérification que les 12 mots saisis sont corrects1. App: GET /auth/restore/challenge → Serveur retourne: { challenge: bytes_aléatoires }2. App: seed_saisi → ed25519_sk = Ed25519.keypair(seed).sk signature = Ed25519.sign(challenge, sk) sk détruite immédiatement3. App: POST /auth/restore/verify { signature } → Serveur: Ed25519.verify(signature, challenge, ed25519_pk) → Valide ✅ = bon seed | Invalide ❌ = mauvais seed// Le seed ne transite jamais sur le réseau ✅ |

| DEC-07 Signature des syncs vaultImpact : Backend Specs section 3, Frontend Specs section 7 |

| // Avant chaque sync vers Storjhash = SHA256(P1)signature = Ed25519.sign(hash, ed25519_sk)POST /vault/sync { category: 'accounts', payload: base64(P1), signature: base64(signature)}// Serveur vérifie avec ed25519_pk avant d'accepter// Garantit que seul le vrai owner peut modifier son backup// Même si access_token compromis ✅ |

# B. Architecture blockchain
| DEC-08 Arbitrum L2 — pas Ethereum mainnetImpact : Backend Specs, Specs Techniques |

| Arbitrum hérite la sécurité d'Ethereum via optimistic rollups. Frais ~$0.005-0.15 par transaction vs $5-100 sur L1. EVM compatible — même tooling Solidity. |

| Critère | Ethereum L1 | Arbitrum L2 |
| Frais par transaction | $5-100+ | ~$0.005-0.15 |
| Sécurité | Maximum | Héritée d'Ethereum |
| Compatibilité EVM | Native | Complète |
| Finalité | ~13 minutes | Soft: 1-2s / Hard: ~13min |
| Migration future | — | Possible vers autre L2 |

| DEC-09 Dead man's switch = smart contract ArbitrumImpact : Backend Specs section 4, Specs Techniques |

| // Smart contract RelaisDeadManSwitch (Solidity)contract RelaisDeadManSwitch { mapping(address => uint256) public lastCheckin; mapping(address => DmsConfig) public config; mapping(address => bytes32) public s1Hash; mapping(address => bytes32) public s2Hash; function checkin() external { lastCheckin[msg.sender] = block.timestamp; emit CheckinRecorded(msg.sender, block.timestamp); } function isTriggered(address owner) public view returns (bool) { return block.timestamp > lastCheckin[owner] + config[owner].silenceDuration; }}// Avantage : fonctionne même si Relais ferme// Code public et vérifiable// Relais ne peut pas empêcher le déclenchement |

| DEC-10 Ce qui va on-chain vs off-chainImpact : Specs Techniques |

| Donnée | Où | Pourquoi |
| ed25519_pk | On-chain Arbitrum | Identité publique — vérification restauration |
| Hash(S1_enc) | On-chain Arbitrum | Preuve intégrité — détecte modification |
| Hash(S2_enc) | On-chain Arbitrum | Preuve intégrité — détecte modification |
| Hash(notification_enc+sig) | On-chain Arbitrum | Preuve intégrité contacts |
| Config DMS (délai, N-of-M) | On-chain Arbitrum | Autonomie du smart contract |
| last_checkin timestamp | On-chain Arbitrum | Seule mise à jour fréquente — inoffensive |
| Storj pointer vers P2 | On-chain Arbitrum | Localisation du backup vault |
| P2 (vault chiffré) | Storj | Blob lourd, mis à jour fréquemment |
| S1_enc, S2_enc | Storj | Chiffrés côté client, pas de hash public du contenu |
| notification_enc | PostgreSQL | Lu par Relais pour notifier |
| secret_enc (contacts) | PostgreSQL | Chiffré avec K2, Relais ne lit pas |

| Le hash de P2 n'est PAS on-chain. Des mises à jour fréquentes créeraient un historique comportemental public exploitable, même sans voir le contenu. |

| DEC-11 Migration blockchain futureImpact : Specs Techniques |

L'architecture est conçue pour permettre une migration vers une autre chain si nécessaire.
- ed25519 / secp256k1 sont standards — même clé fonctionne sur Arbitrum, Base, Polygon
- Smart contract utilise events comme source de vérité — state reconstituable
- L'app mobile connaît l'adresse du contrat — un changement d'adresse via mise à jour suffit
- Données utilisateur (Storj, PostgreSQL) indépendantes de la chain choisie
# C. Architecture des données trusted contacts
| DEC-12 Deux niveaux de données par contactImpact : Specs Techniques, Backend Specs |

| Relais peut lire uniquement pour notifier. Relais ne peut pas modifier sans invalider la signature owner. Relais ne peut pas lire les données secrètes. |

| NIVEAU 1 — notification_enc (Relais peut lire, ne peut pas modifier) Contenu : { email, phone } Chiffrement : XChaCha20(relais_public_key, contenu) Signature : Ed25519.sign(notification_enc, owner_sk) Stockage : PostgreSQL Usage : Relais déchiffre avec relais_private_key pour notifier ✓NIVEAU 2 — secret_enc (Relais ne peut ni lire ni modifier) Contenu : { nom, rôle, questions, message_personnel } Chiffrement : XChaCha20(K2_owner, contenu) Stockage : PostgreSQL Usage : déchiffré uniquement sur le device de l'owner ✓ |

| DEC-13 Vérification réponses = 100% côté clientImpact : Frontend Specs, Backend Specs |

| // Relais ne vérifie PAS les réponses// C'est le device du contact qui vérifieContact saisit réponses dans l'app → K_i = Argon2id(réponses concaténées) → App télécharge S1_enc depuis Storj → XChaCha20_decrypt(K_i, S1_enc) → S1 → Poly1305 succès → réponses correctes ✅ → Poly1305 échec → réponses incorrectes ❌// Relais voit : 'le contact a téléchargé S1_enc'// Relais ne sait pas si les réponses sont bonnes ou mauvaises |

| DEC-14 Transmission = transport aveugleImpact : Specs Techniques |

| // Relais transporte des blobs chiffrés sans les lireMessages personnels → chiffrés avec K2 → Stockés dans secret_enc en PostgreSQL → Déchiffrés sur le device du contact après reconstitution KCarnet de vie → chiffré avec K2 → Stocké dans P2 sur Storj → Téléchargé et déchiffré sur le device du contactRelais = facteur aveugle qui livre des enveloppes fermées ✅ |

| DEC-15 relais_private_key dans HCVImpact : Backend Specs section 5 |

La relais_private_key est le seul secret qui nécessite HCV Secrets Engine. C'est la clé qui déchiffre notification_enc pour envoyer les notifications aux contacts. Elle doit être auditée et rotatable sans redéploiement.
# D. Simplification de HashiCorp Vault
| DEC-16 HCV retiré du chiffrement des données utilisateurImpact : Backend Specs, Specs Techniques |

| P2 n'est plus doublement chiffré par HCV. K seule (XChaCha20) est suffisante. Cela rend l'architecture vraiment non-custodiale — Relais ne peut pas déchiffrer le vault même s'il le voulait. |

| Donnée | Avant | Après |
| P2 (backup vault) | K + HCV Transit | K uniquement — XChaCha20(K, P1) |
| S1_enc, S2_enc | Envisagé HCV | K_A/K_B uniquement — côté client |
| Responsabilité HCV | Chiffrement données + secrets | Secrets infrastructure uniquement |

Justification
- Cohérence avec la philosophie non-custodiale — Relais ne devrait pas pouvoir déchiffrer
- XChaCha20 avec Argon2id est cryptographiquement suffisant
- HCV crée une dépendance critique — si HCV est down, personne ne peut syncer
- Signature Ed25519 remplace l'audit trail HCV pour l'intégrité vault
| DEC-17 HCV réduit à un seul usageImpact : Backend Specs section 5 |

| // HCV avant→ Transit Engine : chiffrement P2→ Secrets Engine : relais_private_key + tous les secrets infra// HCV maintenant — UN SEUL usage→ Secrets Engine : relais_private_key UNIQUEMENT (clé qui déchiffre notification_enc pour notifier les contacts) |

| DEC-18 Secrets infrastructure = variables d'environnement hébergeurImpact : Backend Specs section 8 |

| Secret | Stockage | Justification |
| relais_private_key | HCV Secrets Engine | Critique, doit être auditée et rotatable |
| DATABASE_URL | Env var hébergeur | Simple credential, pas besoin HCV |
| REDIS_URL | Env var hébergeur | Simple credential |
| JWT_ACCESS_SECRET | Env var hébergeur | Rotaté par redéploiement |
| STORJ_ACCESS_KEY | Env var hébergeur | API key standard |
| RESEND_API_KEY | Env var hébergeur | API key standard |
| ARBITRUM_RPC_URL | Env var hébergeur | URL publique |

# E. Tableau récapitulatif — Où tout est stocké
| Donnée | Chiffrement | Stockage | Qui peut lire |
| P2 (vault backup) | K + XChaCha20 | Storj | Owner (K depuis seed) |
| S1_enc | K_A + XChaCha20 | Storj | Contact A (réponses) |
| S2_enc | K_B + XChaCha20 | Storj | Contact B (réponses) |
| notification_enc | relais_public_key | PostgreSQL | Relais (pour notifier) |
| notification_sig | Ed25519 owner | PostgreSQL | Vérifiable par tous |
| secret_enc | K2 + XChaCha20 | PostgreSQL | Owner uniquement |
| verify_token | K_i + XChaCha20 | PostgreSQL | Owner (vérif annuelle) |
| seed_enc_pin | Argon2id(PIN) | SecureStore device | Owner (PIN local) |
| ed25519_pk | — | PostgreSQL + Arbitrum | Public |
| Hash(S1_enc) | — | Arbitrum | Public — preuve intégrité |
| Hash(S2_enc) | — | Arbitrum | Public — preuve intégrité |
| Config DMS | — | Arbitrum | Public — smart contract |
| last_checkin | — | Arbitrum | Public — timestamp |
| relais_private_key | HCV Secrets Engine | HCV | Relais backend uniquement |
| Secrets infra | — | Env vars hébergeur | Relais backend uniquement |

— Fin du Journal des Décisions v1.0 —
Prochaine étape : Schéma PostgreSQL


---

# Patchs DEC-28 / DEC-29 / DEC-30 (docx courant, avril 2026)

RELAIS
Passe le relais, pas le chaos.
Journal des Décisions Architecture — Addendum v1.2
Addendum v1.2 — DEC-28 à DEC-30.
Avril 2026 — Confidentiel
# Addendum v1.2 — DEC-28 à DEC-30
| Décisions issues du formulaire de revue des specs (3 questions ouvertes). Complète l'Addendum v1.1 (DEC-20 à DEC-27). |

| Décision | Titre | Documents impactés |
| DEC-28 | notification_enc : crypto_box_seal (sealed box X25519) — pas XChaCha20 symétrique | Specs Techniques, Backend Specs, Frontend Specs |
| DEC-29 | Si_enc signés Ed25519 à l'activation (comme le vault — DEC-07) | Specs Techniques §4.3, Backend Specs §3.4 |
| DEC-30 | Email activation contacts : en direct via abstraction secrets (pas de stub) | Backend Specs §3.4, Frontend Specs |

| DEC-28 notification_enc : crypto_box_seal X25519 — correction de la formulationImpact : Specs Techniques §1,§4.3 — Backend Specs §3.1 — Frontend Specs §5 |

| ERREUR dans toutes les specs précédentes : XChaCha20(relais_public_key, ...) est incorrect. XChaCha20 est un chiffrement symétrique — il ne peut pas chiffrer vers une clé publique. La primitive correcte est crypto_box_seal de libsodium (ECDH éphémère X25519 + XChaCha20-Poly1305). |

Correction de formulation
| // AVANT (incorrect dans toutes les specs)notification_enc = XChaCha20(relais_public_key, { email, phone })// APRÈS (DEC-28)notification_enc = crypto_box_seal({ email, phone }, relais_x25519_pk)// crypto_box_seal (libsodium) fait internement :// 1. Génère une paire éphémère (ek_pk, ek_sk)// 2. ECDH : shared_secret = X25519(ek_sk, relais_x25519_pk)// 3. Dérive une clé symétrique depuis shared_secret// 4. Chiffre avec XChaCha20-Poly1305// 5. Retourne ek_pk || ciphertext// → Le client ne connaît jamais la clé privée de Relais ✅// Déchiffrement côté serveurplaintext = crypto_box_seal_open( notification_enc, relais_x25519_pk, // clé publique relais_x25519_sk // clé privée — depuis HCV Secrets Engine) |

Endpoint ajouté — Backend Specs §3.1
| // Nouveau endpoint pour exposer la clé publique de RelaisGET /transmission/relais-key → Pas d'authentification requise → Returns: { relais_x25519_pk: base64 } → Mis en cache côté client (la clé change rarement) → Rotatable sans impact sur les clients qui mettent en cache (il suffit d'invalider le cache et de re-fetcher) |

Impact HCV
| // relais_x25519_sk = clé privée X25519 de Relais// Stockée dans HCV Secrets Engine (DEC-15)// C'est la même clé que 'relais_private_key' — juste correctement typée// HCV Secrets Engine — clés stockéesrelais/x25519_sk → clé privée X25519 pour crypto_box_seal_open → notifie les contacts en déchiffrant notification_enc |

| DEC-29 Si_enc signés Ed25519 à l'activation — cohérent avec DEC-07Impact : Specs Techniques §4.3 — Backend Specs §3.4 |

| DEC-07 signe les syncs vault pour garantir qu'un access token volé ne peut pas remplacer le vault. Même argument pour les parts Shamir : un access token volé ne doit pas pouvoir remplacer Si_enc d'un contact par une part hostile qui ferait échouer la transmission. |

| // Côté client — activation transmissionfor each contact_i: S_i = shamir.split(K)[i] // part Shamir brute K_i = Argon2id(réponses_contact_i) Si_enc = XChaCha20(K_i, S_i) // chiffré avec réponses hash_i = SHA256(Si_enc) sig_i = Ed25519.sign(hash_i, ed25519_sk) // ← DEC-29 // push Si_enc sur Storj // envoyer { storj_path, share_hash: hash_i, signature: sig_i } au serveur// Côté serveur — POST /transmission/activatefor each contact_payload: valid = Ed25519.verify(sig_i, hash_i, ed25519_pk) // depuis users table if not valid → rejeter toute l'activation ❌ // Si valide → enregistrer storj_path + share_hash + hash on-chain Arbitrum |

Garantie apportée
| Menace | Sans DEC-29 | Avec DEC-29 |
| Access token volé avant activation | Attaquant remplace Si_enc → transmission échoue silencieusement | Impossible — signature invalide sans ed25519_sk |
| Serveur Relais compromis | Si_enc remplacés en base | Hash on-chain Arbitrum détecte la modification |
| Si_enc corrompus sur Storj | Déchiffrement échoue mais sans preuve | SHA256(Si_enc) vérifiable on-chain à tout moment |

| DEC-30 Email activation contacts : en direct via abstraction secretsImpact : Backend Specs §3.4 — src/services/secrets.ts |

| La gestion de la clé est déjà tranchée (DEC-15 : relais_x25519_sk dans HCV). Un stub repousserait une décision déjà prise et laisserait un trou dans le flow critique E3-US06. |

Abstraction secrets
| // src/services/secrets.ts// Abstraction fine : env var en dev/test, HCV en prod// Le reste du code ne connaît pas HCV directementasync function getRelaisX25519Sk(): Promise<Buffer> { if (process.env.NODE_ENV === 'production') { return await hcv.getSecret('relais/x25519_sk') } // Dev / test : clé en variable d'env locale return Buffer.from(process.env.RELAIS_X25519_SK_DEV!, 'hex')}export const secrets = { getRelaisX25519Sk } |

Flow E3-US06 complet
| // POST /transmission/activate1. Vérifier step-up token 'activate_transmission'2. Vérifier signatures Ed25519 des Si_enc (DEC-29)3. Si valides → push Si_enc sur Storj + hashes on-chain Arbitrum4. Pour chaque contact : sk = await secrets.getRelaisX25519Sk() { email, phone } = crypto_box_seal_open(notification_enc, pk, sk) // DEC-28 resend_id = await resend.send({ to: email, template: 'transmission_activated' }) INSERT email_log { email_type: 'transmission_contact', provider_id: resend_id }5. UPDATE transmission_configs SET status = 'active', activated_at = NOW()6. Enregistrer checkin on-chain Arbitrum (contrat register())7. Returns { activated: true, contacts_notified: N } |

Portée de l'abstraction
- HCV peut être branché, remplacé ou migré sans toucher les handlers
- Les tests unitaires utilisent la branche env var — pas besoin de mock HCV
- La même abstraction couvre toute clé sensible future si besoin
# Résumé des corrections à appliquer dans les specs
| Document | Section | Correction |
| Specs Techniques | §1 Vocabulaire | notification_enc : remplacer XChaCha20(relais_public_key) par crypto_box_seal(..., relais_x25519_pk) |
| Specs Techniques | §4.3 Création des clés | Idem — formulation corrigée + signature Si_enc ajoutée |
| Backend Specs | §3.1 Auth | Ajouter GET /transmission/relais-key |
| Backend Specs | §3.4 Transmission | POST /transmission/activate : signature par contact (DEC-29) + email direct (DEC-30) |
| Frontend Specs | §5.2 Crypto | crypto_box_seal pour notification_enc (DEC-28) |
| Frontend Specs | §4.3 Transmission | Ajout signature Ed25519 sur Si_enc à l'activation (DEC-29) |

— Fin de l'Addendum v1.2 — DEC-28 à DEC-30
