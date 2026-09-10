RELAIS
Passe le relais, pas le chaos.
Specs Techniques — Chiffrement & Cycles de vie
Version 1.1 — Avril 2026 — Confidentiel
Corrections v1.1 : HCV Transit retiré (DEC-16/17), architecture wallet Ed25519, seed_enc_pin permanent, Arbitrum L2, trusted contacts deux niveaux.
# 1. Vocabulaire
Termes utilisés de façon cohérente dans tout le document.
| Terme | Définition |
| D | Données brutes saisies par l'utilisateur (login, mot de passe, instructions). Existent en clair uniquement en mémoire vive. |
| K | Clé symétrique 256 bits. Dérivée du seed via Argon2id. Chiffre D. Ne quitte jamais la mémoire vive. |
| P1 | D chiffré avec K via XChaCha20-Poly1305. Stocké dans la base locale SQLite. |
| P2 | P1 rechiffré avec K via XChaCha20-Poly1305. Stocké sur Storj. Backup du vault. (v1.1 : plus de HCV Transit — K seule suffit) |
| S1...SM | Parts Shamir de K. 32 bytes bruts chacune. Inutilisable seule. M parts créées, N suffisent pour reconstituer K. |
| K_i | Clé éphémère 256 bits dérivée des réponses du Contact i via Argon2id. Jamais stockée. |
| Si_enc | Si chiffré avec K_i. 32 bytes. Stocké sur Storj. Hash stocké on-chain Arbitrum. |
| ed25519_pk | Clé publique Ed25519 dérivée du seed. Stockée en PostgreSQL et on-chain Arbitrum. Sert à vérifier les signatures et la restauration. |
| ed25519_sk | Clé privée Ed25519 dérivée du seed à la demande. Jamais stockée. Signe les syncs vault et les challenges de restauration. |
| seed_enc_pin | Seed chiffré avec Argon2id(PIN). Stocké dans expo-secure-store. PERMANENT — jamais supprimé. |
| notification_enc | {email, phone} du contact chiffré avec relais_public_key. Relais peut lire pour notifier. Protégé par signature Ed25519 owner contre modification. |
| secret_enc | {nom, rôle, questions, message} du contact chiffré avec K2 de l'owner. Relais ne peut pas lire. |
| verify_token | XChaCha20(K_i, 'RELAIS_VERIFY_OK'). ~40 bytes. Permet à l'owner de vérifier ses réponses sans déchiffrer le vault. |
| Seed | 12 mots BIP39. Source de K1/K2/K3 et de ed25519_pk/sk. Ne quitte jamais le device. |
| Base locale | SQLite chiffré sur le device. Source de vérité. |
| Escrow | PostgreSQL temporaire (TTL 72h) pour Si_tmp pendant reconstitution des contacts. |
| HCV | HashiCorp Vault — Secrets Engine UNIQUEMENT. Stocke relais_private_key. (v1.1 : HCV Transit retiré) |
| Storj | Stockage objet distribué. Stocke P2 et Si_enc. Fragmenté sur N noeuds. |
| Arbitrum | L2 Ethereum. Smart contract du dead man's switch. Stocke ed25519_pk, hashes Si_enc, config DMS. |

# 2. Algorithmes utilisés
| Algorithme | Rôle | Pourquoi ce choix |
| BIP39 | Génération du seed (12 mots) | Standard universel, portable, mémorisable par un humain |
| Argon2id | Dérivation de clés depuis seed, PIN ou réponses | Résistant au brute force, lent et coûteux en mémoire intentionnellement |
| XChaCha20-Poly1305 | Chiffrement symétrique de D, P2, Si, notify, journal | Rapide, sûr, garantit confidentialité ET intégrité. Nonce 192 bits élimine les risques de réutilisation. |
| Shamir Secret Sharing N-of-M | Découpe K en parts Si | Aucune part seule ne révèle K. Reconstruction exacte avec N parts. |
| Ed25519 | Signature des syncs vault et challenge-response restauration | Courbe elliptique rapide. Dérivée du seed — pas de clé supplémentaire à gérer. |
| SHA256 | Hash de P1 avant signature Ed25519 | Preuve d'intégrité du vault avant upload. |
| Storj | Stockage distribué de P2 et Si_enc | Fragmentation — aucun noeud ne détient un fichier complet. |
| Arbitrum L2 | Smart contract dead man's switch | Autonome, hérite sécurité Ethereum, frais ~$0.005-0.15 par tx. |

| v1.1 — HCV Transit Secrets Engine RETIRÉ. P2 est chiffré uniquement par K (XChaCha20-Poly1305). Relais ne peut plus déchiffrer le vault — architecture vraiment non-custodiale. HCV réduit à relais_private_key dans Secrets Engine. |

# 3. Catégories de données et clés
Trois catégories indépendantes. Chaque catégorie a sa propre clé Ki dérivée directement du seed via Argon2id avec un contexte distinct.
| // DÉRIVATION DIRECTE DEPUIS LE SEEDseed + ctx='relais_comptes_v1' → Argon2id → K1seed + ctx='relais_messages_v1' → Argon2id → K2seed + ctx='relais_finances_v1' → Argon2id → K3// ED25519 KEYPAIR — même seedseed → Ed25519.keypair() → { ed25519_sk, ed25519_pk }ed25519_pk → PostgreSQL + Arbitrum (public, immuable)ed25519_sk → dérivé à la demande, jamais stocké// K1, K2, K3 mathématiquement indépendantes// Compromission de l'une ne compromet pas les autres |

| Clé | Catégorie | Données | Rôle destinataire |
| K1 | Comptes & accès | Logins, mots de passe, instructions de fermeture | Gestionnaire pratique |
| K2 | Messages personnels | Lettres, carnet de vie, messages par contact | Gardien du souvenir |
| K3 | Données financières | Comptes bancaires, investissements | Exécuteur financier |

# 4. Schéma Shamir N-of-M
| Schéma | M contacts | N requis | Usage |
| 2-of-2 | 2 | 2 (les deux) | Cas minimal — deux proches de confiance |
| 2-of-3 | 3 | 2 (n'importe lesquels) | Résilient — si un contact est injoignable |
| 3-of-5 | 5 | 3 (n'importe lesquels) | Haute disponibilité — famille élargie |

| // Exemple : 2-of-3 pour K1 (comptes & accès)K1 → Shamir 2-of-3 → S1_A, S1_B, S1_CArgon2id(réponses_A) → K_A → XChaCha20(K_A, S1_A) → S1_A_encArgon2id(réponses_B) → K_B → XChaCha20(K_B, S1_B) → S1_B_encArgon2id(réponses_C) → K_C → XChaCha20(K_C, S1_C) → S1_C_enc// Si_enc stockés sur Storj// Hash(Si_enc) stockés on-chain Arbitrum (preuve intégrité)// N'importe quels 2 contacts parmi A, B, C suffisent ✅ |

# 5. Architecture de stockage
| v1.1 — P2 chiffré par K seule (plus HCV Transit). Si_enc stockés sur Storj (plus PostgreSQL). Hash(Si_enc) on-chain Arbitrum comme preuve d'intégrité. |

| Donnée | Chiffrement | Où | Qui peut lire |
| D (données brutes) | — | Mémoire vive uniquement | Owner (session active) |
| K1, K2, K3 | — | Mémoire vive uniquement | Owner (session active) |
| P1_1, P1_2, P1_3 | Ki + XChaCha20 | SQLite local | Owner (Ki depuis seed) |
| P2_1, P2_2, P2_3 | Ki + XChaCha20 | Storj | Owner (Ki depuis seed) |
| Si_enc (toutes parts) | K_i + XChaCha20 | Storj | Contact i (réponses) |
| Hash(Si_enc) | — | Arbitrum (public) | Tous — preuve intégrité |
| notification_enc | {email,phone} chiffré relais_public_key | PostgreSQL | Relais (pour notifier) |
| notification_sig | Ed25519.sign(notification_enc, owner_sk) | PostgreSQL | Vérifiable par tous |
| secret_enc | {nom,rôle,questions,message} chiffré K2 | PostgreSQL | Owner uniquement |
| verify_token | XChaCha20(K_i, 'RELAIS_VERIFY_OK') | PostgreSQL | Owner (vérif annuelle) |
| seed_enc_pin | XChaCha20(Argon2id(PIN), seed) | expo-secure-store | Owner (PIN local) |
| ed25519_pk | — | PostgreSQL + Arbitrum | Public |
| Config DMS, last_checkin | — | Arbitrum | Public (smart contract) |
| relais_private_key | HCV Secrets Engine | HCV | Relais backend |
| Secrets infra | — | Env vars hébergeur | Relais backend |

# 6. Cycles de vie
## 6.1 Création du compte
| App génère 12 mots BIP39 aléatoirement→ Affichés UNE seule fois (écran non-passable)→ L'utilisateur les note physiquement→ JAMAIS stockés côté serveur// DÉRIVATION DES CLÉSseed + ctx='relais_comptes_v1' → Argon2id → K1seed + ctx='relais_messages_v1' → Argon2id → K2seed + ctx='relais_finances_v1' → Argon2id → K3seed → Ed25519.keypair() → { ed25519_sk, ed25519_pk }→ ed25519_pk envoyée au serveur et on-chain Arbitrum→ ed25519_sk détruite immédiatement// SEED_ENC_PIN — STOCKAGE PERMANENTUser crée son PINpin_key = Argon2id(pin, pin_salt, ctx='relais_pin_enc_v1')seed_enc_pin = XChaCha20(pin_key, seed)→ SecureStore.set('seed_enc_pin', ...) ← PERMANENT, jamais supprimé// BASE LOCALESQLite chiffré créé sur le device — trois tables (K1, K2, K3)// BACKUP INITIAL SUR STORJP1_1, P1_2, P1_3 → XChaCha20(Ki, P1_i) → P2_i → Storjhash = SHA256(P1_i)signature = Ed25519.sign(hash, ed25519_sk) — serveur vérifie avant stockage// Compte créé. Transmission PAS encore activée. |

## 6.2 Saisie et chiffrement local
| L'utilisateur tape ses données dans l'appD = { service: 'Netflix', login: '...', mdp: '...', instructions: '...' }→ D en clair uniquement en mémoire viveApp chiffre immédiatement avec KiXChaCha20(K1, D) → P1_1 (comptes)XChaCha20(K2, D) → P1_2 (messages)XChaCha20(K3, D) → P1_3 (finances)→ D en clair détruit de la mémoire après chiffrementP1_i écrit dans SQLite local// SYNC STORJ (asynchrone, debounced 3s)hash = SHA256(P1_i)signature = Ed25519.sign(hash, ed25519_sk)P2_i = XChaCha20(Ki, P1_i) // plus de HCV Transit ✅POST /vault/sync { payload: P2_i, signature }→ Serveur vérifie signature avec ed25519_pk→ Storj stocke P2_i si signature valide |

## 6.3 Création des clés (activation transmission)
| L'utilisateur désigne M trusted contacts→ Choisit schéma N-of-M→ Pour chaque contact : rôle(s) + questions secrètes// NIVEAU 1 — notification_enc (Relais peut lire pour notifier)notification_enc = XChaCha20(relais_public_key, { email, phone })notification_sig = Ed25519.sign(notification_enc, owner_sk)→ notification_enc + sig → PostgreSQL→ Hash(notification_enc + sig) → Arbitrum (preuve intégrité)// NIVEAU 2 — secret_enc (Relais ne peut PAS lire)secret_enc = XChaCha20(K2, { nom, rôle, questions, message })→ secret_enc → PostgreSQL// DÉCOUPE DE CHAQUE KiK1 → Shamir N-of-M → S1_1...S1_MK2 → Shamir N-of-M → S2_1...S2_MK3 → Shamir N-of-M → S3_1...S3_M// PROTECTION DE CHAQUE PARTArgon2id(réponses_contact_i) → K_iXChaCha20(K_i, Sj_i) → Sj_i_encK_i détruite immédiatement→ Sj_i_enc → Storj→ Hash(Sj_i_enc) → Arbitrum// VERIFY TOKENXChaCha20(K_i, 'RELAIS_VERIFY_OK') → verify_token_i→ verify_token_i → PostgreSQL (~40 bytes)K_i détruite immédiatement |

## 6.4 Upload (sync vault → Storj)
| // Déclenché automatiquement après chaque modificationP1_i lus depuis SQLite localhash = SHA256(P1_i)ed25519_sk = Ed25519.keypair(seed).sk // dérivée à la demandesignature = Ed25519.sign(hash, ed25519_sk)ed25519_sk.fill(0) // détruite immédiatementP2_i = XChaCha20(Ki, P1_i) // chiffrement côté client uniquementPOST /vault/sync { category, payload: P2_i, signature }→ Serveur vérifie : Ed25519.verify(signature, hash, ed25519_pk) ✅→ Storj stocke P2_i fragmenté sur N noeuds// Si_enc NE passent PAS par ce flow// Stockés sur Storj directement à l'activation transmission |

## 6.5 Accès quotidien (pré-mortem)
| // Déverrouillage PIN ou biométriepin_key = Argon2id(pin_saisi, pin_salt)seed = XChaCha20_decrypt(pin_key, seed_enc_pin) // depuis SecureStoreK1 = Argon2id(seed, 'relais_comptes_v1')K2 = Argon2id(seed, 'relais_messages_v1')K3 = Argon2id(seed, 'relais_finances_v1')seed.fill(0) // détruit immédiatement// Lecture depuis SQLite local — aucun appel réseauXChaCha20_decrypt(K1, P1_1) → D1 (comptes & accès)XChaCha20_decrypt(K2, P1_2) → D2 (messages)XChaCha20_decrypt(K3, P1_3) → D3 (finances)→ D1 D2 D3 affichés dans l'app// À la fermeture / arrière-plan > 10minK1, K2, K3 → détruites de la mémoire viveD1, D2, D3 → détruits de la mémoire viveseed_enc_pin → toujours présent dans SecureStore ✅ |

## 6.6 Restauration — nouveau device
| // seed_enc_pin absent (nouveau device ou réinstallation)1. Login mot de passe → auth serveur → tokens2. App détecte : seed_enc_pin absent3. 'Créez votre PIN pour ce téléphone' → PIN différent de l'ancien device = normal4. 'Entrez vos 12 mots pour restaurer votre coffre'// VÉRIFICATION DU SEED (challenge-response Ed25519)GET /auth/restore/challenge → { challenge: bytes_aléatoires }seed_saisi = BIP39.toBytes(12_mots)ed25519_sk = Ed25519.keypair(seed_saisi).sksignature = Ed25519.sign(challenge, ed25519_sk)ed25519_sk.fill(0)POST /auth/restore/verify { signature }→ Serveur vérifie avec ed25519_pk en base ✅ ou ❌// SI VALIDEpin_key = Argon2id(nouveau_PIN, pin_salt)seed_enc_pin = XChaCha20(pin_key, seed_saisi)SecureStore.set('seed_enc_pin', seed_enc_pin) // PERMANENT// RESTAURATION DU VAULTK1, K2, K3 dérivées depuis seed_saisiTélécharge P2_1, P2_2, P2_3 depuis StorjP1_i = XChaCha20_decrypt(Ki, P2_i)Écrit P1_i dans nouvelle SQLite locale ✅// S1_enc, S2_enc non touchés — transmission inchangée |

## 6.7 Reconstitution des clés (post-mortem)
| // DÉCLENCHEMENT — Smart contract Arbitrum (autonome)block.timestamp > lastCheckin[owner] + silenceDuration → isTriggered = true// Email envoyé à chaque contact avec lien app + token unique// CHAQUE CONTACT (asynchrone, n'importe quel ordre)Contact i clique le lien → ouvre l'app→ Réponses aux questions secrètes saisies→ K_i = Argon2id(réponses_i)→ App télécharge Si_enc depuis Storj→ XChaCha20_decrypt(K_i, Si_enc) → Si→ K_i détruite immédiatement→ Si re-chiffré clé session tmp → Si_tmp → escrow PostgreSQL (TTL 72h)// RECONSTITUTION QUAND N PARTS DISPONIBLESS1_tmp + S2_tmp + ... (N parts) → Shamir → K reconstituée ✅→ Escrow vidé immédiatement// VÉRIFICATION INTÉGRITÉ (optionnel)Hash(Si_enc) vérifiable on-chain Arbitrum→ Garantit que les parts n'ont pas été modifiées par Relais |

## 6.8 Déchiffrement final et transmission (post-mortem)
| // K1, K2, K3 en mémoire vive sur le device du dernier contactPour chaque catégorie j :App télécharge P2_j depuis StorjP1_j = XChaCha20_decrypt(Kj, P2_j) // plus de HCV ✅Dj = déchiffré en clair → mémoire vive uniquementDj transmis au data recipient désigné→ Affiché dans l'app du recipient→ Recipient peut exporter localement// NETTOYAGE IMMÉDIATP2_j supprimé de StorjSi_enc supprimés de Storj pour tous les contactsEscrow Si_tmp supprimé de PostgreSQLKj détruite de la mémoire vivePostgreSQL → statut 'transmis' + timestamp→ Seul le log de transmission est conservé |

# 7. Avertissements onboarding et révision annuelle
## 7.1 Avertissements obligatoires
| Ces écrans sont non-passables. L'utilisateur doit cocher chaque confirmation avant de continuer. |

Avertissement 1 — Les 12 mots sont irremplaçables
| Ces 12 mots sont la clé de votre coffre. Si vous les perdez, votre compte ne pourra plus jamais être restauré sur un nouveau téléphone — même par Relais. Notez-les maintenant dans un endroit physique et sûr. |

- Affiché immédiatement après la génération des 12 mots
- Checkbox obligatoire : 'J'ai bien noté mes 12 mots dans un endroit physique sûr'
- Copier/coller désactivé sur cet écran
Avertissement 2 — Responsabilité du choix des contacts
| Si vos contacts ne peuvent pas répondre aux questions secrètes, et que vos 12 mots sont introuvables, vos informations seront définitivement inaccessibles. Choisissez des contacts fiables et des questions dont vous êtes certain qu'ils se souviendront. |

- Affiché lors de la configuration de la transmission
- Checkbox : 'Je comprends que Relais ne peut pas contourner ces questions'
Avertissement 3 — Ce que Relais peut et ne peut pas faire
| Relais PEUT faire | Relais NE PEUT PAS faire |
| Réinitialiser les tentatives échouées d'un contact | Voir le contenu de votre vault |
| Étendre le délai de l'escrow | Contourner les questions secrètes |
| Confirmer que les emails ont bien été envoyés | Déchiffrer vos données sans vos clés |
| Guider vos proches vers vos 12 mots physiques | Récupérer vos données si les 12 mots sont perdus |

## 7.2 Vérification annuelle — verify_token
| // À LA CONFIGURATION DES QUESTIONS (setup)Owner saisit les réponses pour Contact iK_i = Argon2id(réponses_i concaténées, ctx='relais_contact_v1')verify_token_i = XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1')→ verify_token_i → PostgreSQL (~40 bytes)K_i détruite immédiatement — réponses jamais stockées// LORS DE LA RÉVISION ANNUELLE (check-in)Owner re-saisit les réponses telles qu'il les a définiesK_i_test = Argon2id(réponses_saisies, ctx='relais_contact_v1')result = XChaCha20_decrypt(K_i_test, verify_token_i)succès → result == 'RELAIS_VERIFY_OK_V1' → réponses correctes ✓erreur → Poly1305 authentication failed → réponses incorrectes ✗K_i_test détruite immédiatement |

| Champ | Type | Description |
| verify_token_i | BYTEA ~40 bytes | Un par trusted contact. Recréé si les questions changent. |
| verify_last_checked_at | TIMESTAMP | Date de la dernière vérification réussie par l'owner. |

# 8. Sécurité du compte
## 8.1 Inscription
| Champ | Obligatoire | Remarque |
| Prénom + Nom | Oui | Personnalisation de l'expérience |
| Email | Oui | Identifiant principal — vérifié par OTP 6 chiffres |
| Numéro de téléphone | Oui | Collecté dès V1. Utilisé pour 2FA SMS en V2. |
| Mot de passe | Oui | Auth serveur uniquement. Pas de rôle crypto côté client (v1.1). |

## 8.2 Authentification quotidienne
| Niveau | Mécanisme | Usage |
| Niveau 1 | Biométrie (Face ID / empreinte) | Déverrouille l'app. Rapide, sans friction. |
| Niveau 2 — Fallback | PIN à 6 chiffres | Si biométrie indisponible. Déchiffre seed_enc_pin → K1 K2 K3. |
| Niveau 3 — Critique | Mot de passe complet + PIN | Nouveau device, inactivité > 3 mois. |

| v1.1 — Le mot de passe n'a plus de rôle dans la dérivation des clés. K1/K2/K3 sont toujours dérivées depuis seed. Le PIN chiffre seed_enc_pin localement. Le mot de passe sert uniquement à l'authentification serveur. |

## 8.3 Gestion des sessions
| Situation | Comportement |
| Session active | Biométrie ou PIN suffisent |
| Arrière-plan > 10min | K1 K2 K3 détruites — PIN requis au retour |
| Inactivité > 3 mois | Login mot de passe requis → PIN → seed_enc_pin → K1 K2 K3. seed_enc_pin toujours présent. |
| Nouveau device | Mot de passe + PIN + 12 mots obligatoires |

## 8.4 Actions sensibles — Step-up token
| Le PIN ne transite jamais sur le réseau. Les actions sensibles utilisent un step-up token : le client valide le PIN localement, puis demande un token court-vécu au serveur. |

- Modifier les trusted contacts → action 'edit_contacts'
- Activer / modifier la transmission → action 'edit_transmission'
- Désactiver le dead man's switch → action 'delete_transmission'
- Afficher à nouveau les 12 mots → action 'view_seed'
- Changer le mot de passe → action 'change_password'
- Désactiver 2FA → action 'disable_2fa'
## 8.5 Double authentification (2FA)
| Mécanisme | Statut | Remarque |
| TOTP (Google Authenticator / Authy) | V1 — optionnel | Activable dans les paramètres. Fonctionne hors ligne. |
| SMS OTP | V2 | Reporté — coût opérateur. Numéro collecté dès V1. |
| Email OTP | Jamais | Trop lent, risque spam, mauvaise UX mobile. |

# 9. Garanties de sécurité
| v1.1 — Les scénarios 'HCV piraté' et 'P2 doublement chiffré' sont supprimés. P2 est protégé par K (XChaCha20) uniquement. La protection principale est que K n'est jamais sur le serveur. |

| Scénario d'attaque | Ce que l'attaquant obtient | Résultat |
| Serveurs Relais piratés | P2 + Si_enc hashes + notification_enc + metadata | P2 illisible sans K (jamais sur serveur). Si_enc illisibles sans réponses. notification_enc illisible sans relais_private_key. |
| Storj piraté | Fragments de P2 et Si_enc | Fragments incomplets. P2 illisible sans K. Si_enc illisibles sans K_i. |
| relais_private_key compromise | Déchiffrement de notification_enc | Accès aux emails/téléphones des contacts. Pas accès au vault ni aux parts Shamir. |
| Contact A malveillant seul | S1 (sa part uniquement) | S1 seul ne reconstitue pas K. N-1 parts manquantes. |
| Dev Relais avec accès root | P2 + Si_enc + metadata | P2 illisible sans K. K jamais côté serveur. Si_enc illisibles sans réponses contacts. |
| Interception réseau | P2 ou Si_enc en transit | Toujours chiffré + TLS. D ne transite jamais en clair. |
| Brute force des réponses | Tentatives sur K_i | Argon2id rend chaque tentative coûteuse en temps et mémoire. |
| Smart contract Arbitrum piraté | Hashes Si_enc, config DMS | Données en lecture seule on-chain. Si_enc eux-mêmes sur Storj, illisibles sans K_i. |

# 10. Carnet de vie — Check-in & Capsule temps
Le carnet de vie est la dimension émotionnelle de Relais. Chaque check-in mensuel produit une entrée dans un journal privé. L'ensemble constitue une capsule temps transmise au Gardien du souvenir.
## 10.1 Structure du check-in mensuel
| Étape | Ce qui se passe | Durée |
| 1. Énigme de preuve de vie | Mini-jeu ou énigme à résoudre. Valide la présence. Obligatoire. | < 60 secondes |
| 2. Question du carnet | Question thématique. Réponse libre. Optionnelle mais encouragée. | 2 à 5 minutes |
| 3. Badge et streak | Animation de complétion. Badge du mois débloqué. | 5 secondes |

## 10.2 Chiffrement du carnet
| // Entrées du carnet chiffrées avec K2 (messages personnels)content_enc = XChaCha20(K2, { question_id, mois, mode, texte })→ PostgreSQL (metadata) + Storj (contenu dans P2_2)// Changement de Gardien du souvenirK2 stable — dérivée du seed, ne change pasSeules les parts Shamir de K2 sont redistribuées→ Ancien S2_enc supprimé de Storj→ Nouveau S2_enc créé avec K_nouveau_gardien → Storj→ Ancien Gardien perd tout accès immédiatement ✅ |

## 10.3 Wrapped annuel
- Généré localement si ≥ 6 entrées dans l'année
- Calculé en mémoire vive depuis données déchiffrées — jamais en transit
- Exportable en image PNG (statistiques uniquement — jamais de contenu verbatim)
- Watermark Relais discret dans l'image exportée
- stats_enc = XChaCha20(K2, stats_aggregées) → PostgreSQL
# 11. Infrastructure
| v1.1 — HashiCorp Vault Transit Engine retiré. HCV réduit à Secrets Engine pour relais_private_key uniquement. Arbitrum L2 ajouté pour le smart contract DMS. |

| Service | Rôle | Version initiale |
| PostgreSQL | Metadata, questions, notification_enc, secret_enc, verify_token, escrow, logs | Managed (Supabase ou Railway) |
| Storj | P2 (vault backup) + Si_enc (parts Shamir) | Storj DCS (S3-compatible) |
| Arbitrum L2 | Smart contract DMS autonome. Stocke ed25519_pk, hashes Si_enc, config, last_checkin. | Arbitrum One |
| HashiCorp Vault | Secrets Engine — relais_private_key UNIQUEMENT | HCP Vault Dedicated (V1) |
| React Native | App mobile iOS + Android | Expo bare workflow |
| Node.js + Fastify | API serveur Relais | Node.js 22 LTS |
| libsodium | XChaCha20, Argon2id, Ed25519, Shamir côté client | libsodium-wrappers |
| BullMQ + Redis | Jobs asynchrones V1 (remplacés par smart contract V2) | Redis managed |

— Fin des Specs Techniques v1.1 —
Corrections v1.1 : DEC-16/17 (HCV Transit retiré) + DEC-01 à DEC-19 intégrés
