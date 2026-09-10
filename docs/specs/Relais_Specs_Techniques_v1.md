RELAIS
Specs Techniques — Chiffrement & Cycles de vie
Version 1.0 — Avril 2026 — Confidentiel
# 1. Vocabulaire
Avant de décrire les flows, voici les termes utilisés de façon cohérente dans tout le document.
| Terme | Définition |
| D | Les données brutes saisies par l'utilisateur (login, mot de passe, instructions). Existent en clair uniquement en mémoire vive. |
| K | Clé maître symétrique 256 bits. Dérivée du seed. Chiffre D. Ne quitte jamais la mémoire vive. |
| P1 | D chiffré avec K via XChaCha20-Poly1305. Stocké dans la base locale SQLite. |
| P2 | P1 rechiffré par HashiCorp Vault Transit. Stocké sur Storj. Relais ne peut pas le lire. |
| S1 | Part mathématique 1 de K via Shamir 2-of-2. 32 bytes bruts, inutilisable seul. |
| S2 | Part mathématique 2 de K via Shamir 2-of-2. 32 bytes bruts, inutilisable seul. |
| K_A | Clé éphémère 256 bits dérivée des réponses du Contact A. Jamais stockée. |
| K_B | Clé éphémère 256 bits dérivée des réponses du Contact B. Jamais stockée. |
| S1_enc | S1 chiffré avec K_A. 32 bytes. Stocké en PostgreSQL. |
| S2_enc | S2 chiffré avec K_B. 32 bytes. Stocké en PostgreSQL. |
| Seed | 12 mots BIP39 générés à la création du compte. Source de tout. Jamais stockés. |
| Base locale | SQLite chiffré sur le device de l'utilisateur. Source de vérité. |
| Backup chiffré | P2 stocké sur Storj. Copie de secours uniquement. |
| Escrow | Enregistrement PostgreSQL temporaire (TTL 72h) contenant S1 re-chiffré pendant la synchronisation des contacts. |
| HCV | HashiCorp Vault Transit — service de chiffrement par API. Clé jamais accessible par Relais. |
| Storj | Stockage objet distribué. Stocke P2 fragmenté sur N noeuds. Aucun noeud ne détient un fichier complet. |

# 2. Algorithmes utilisés
| Algorithme | Rôle | Pourquoi ce choix |
| BIP39 | Génération du seed (12 mots) | Standard universel, portable, mémorisable par un humain |
| Argon2id | Dérivation de clés depuis mot de passe ou réponses | Résistant au brute force, lent et coûteux en mémoire intentionnellement |
| XChaCha20-Poly1305 | Chiffrement symétrique de D et des parts S1/S2 | Rapide, sûr, garantit confidentialité ET intégrité des données |
| Shamir Secret Sharing 2-of-2 | Découpe K en S1 et S2 | Aucune part seule ne révèle K. Reconstruction exacte avec les deux. |
| HCV Transit Secrets Engine | Couche de chiffrement infrastructure sur P1 | Zero trust interne — même Relais ne peut pas lire P2. Rotation de clés. Audit trail. |
| Storj | Stockage distribué de P2 | Fragmentation — aucun noeud ne détient un fichier complet |

# 3. Catégories de données et clés
Les données sont organisées en trois catégories indépendantes. Chaque catégorie a sa propre clé Ki dérivée directement du seed via Argon2id avec un contexte distinct. Les clés sont mathématiquement indépendantes — connaître K1 ne révèle rien sur K2 ou K3.
| // DÉRIVATION DIRECTE DEPUIS LE SEED — PAS DE K_ROOTseed + ctx='relais_comptes_v1' → Argon2id → K1seed + ctx='relais_messages_v1' → Argon2id → K2seed + ctx='relais_finances_v1' → Argon2id → K3// Le contexte est une chaîne fixe connue de l'app (pas un secret)// Le versioning (_v1) permet d'évoluer l'algo sans casser l'existant// K1, K2, K3 totalement indépendants — compromission de l'un// ne compromet pas les autres |

| Clé | Catégorie | Données concernées | Rôle destinataire |
| K1 | Comptes & accès | Logins, mots de passe, instructions de fermeture | Gestionnaire pratique |
| K2 | Messages personnels | Lettres, capsule temps, messages par contact | Gardien du souvenir |
| K3 | Données financières | Comptes bancaires, investissements, Neero | Exécuteur financier |

Un même contact peut avoir plusieurs rôles. Il reçoit alors les parts Shamir de toutes les Ki correspondant à ses rôles. L'isolation est cryptographique — un contact Gestionnaire ne peut pas accéder à D2 ou D3, pas seulement par contrôle d'accès applicatif mais par impossibilité mathématique.
# 4. Schéma Shamir N-of-M
Le système supporte plusieurs trusted contacts avec un schéma flexible N-of-M. N parts suffisent parmi M créées. Le minimum absolu est 2-of-2 par contrainte de design de sécurité.
| Schéma | M contacts créés | N requis pour reconstituer | Usage typique |
| 2-of-2 | 2 | 2 (les deux) | Cas minimal — deux proches de confiance |
| 2-of-3 | 3 | 2 (n'importe lesquels) | Résilient — si un contact est injoignable |
| 3-of-5 | 5 | 3 (n'importe lesquels) | Haute disponibilité — famille élargie |

Pour chaque catégorie Ki, le schéma Shamir est appliqué indépendamment. Les contacts désignés pour un rôle reçoivent les parts Si correspondant à Ki uniquement.
| // Exemple : 2-of-3 pour K1 (comptes & accès)K1 → Shamir 2-of-3 → S1_1, S1_2, S1_3Argon2id(réponses Contact A) → K_A → chiffre S1_1 → S1_1_encArgon2id(réponses Contact B) → K_B → chiffre S1_2 → S1_2_encArgon2id(réponses Contact C) → K_C → chiffre S1_3 → S1_3_enc// N'importe quels 2 contacts parmi A, B, C suffisent pour reconstituer K1// Si C est injoignable : A + B reconstituent K1 ✅ |

# 5. Architecture de stockage
Deux concepts de stockage sont clairement séparés et indépendants l'un de l'autre.
| Concept | Quand créé | Lien avec les clés |
| Backup de restauration (P2 sur Storj) | Dès la création du compte, mis à jour à chaque modification | Aucun lien avec S1/S2. Permet la restauration multi-device. |
| Activation de la transmission (S1_enc, S2_enc) | Uniquement quand l'user configure ses contacts | Découpage de K en parts Shamir. Stable jusqu'au déclenchement. |

| Donnée | Où | Justification |
| D (données brutes) | Mémoire vive uniquement | Ne touche jamais le disque en clair |
| K1, K2, K3 (clés catégories) | Mémoire vive uniquement | Dérivées à la demande, détruites à la fermeture |
| P1_1, P1_2, P1_3 | SQLite local (base locale) | Source de vérité sur le device, chiffrés par Ki |
| P2_1, P2_2, P2_3 | Storj | Backup chiffré par HCV, distribué, fragmenté |
| Si_enc (toutes parts) | PostgreSQL | 32 bytes chacune, contrôle d'accès fin, logs précis |
| Questions secrètes (texte) | PostgreSQL | Non-sensible, requêtable |
| Config dead man's switch | PostgreSQL | Structuré, requêtable |
| Escrow Si_tmp | PostgreSQL (TTL 72h) | Temporaire, détruit après usage |
| Metadata utilisateur | PostgreSQL | Profil, statuts, logs de check-in |
| Secrets infra (clés API, etc.) | HCV Secrets Engine | Séparé du Transit Engine |

# 6. Cycles de vie
## 4.1 Cycle de vie — Création du compte
Ce qui se passe quand l'utilisateur crée son compte pour la première fois.
| App génère 12 mots BIP39 aléatoirement → Affichés UNE seule fois à l'écran → L'utilisateur les note physiquement → JAMAIS stockés nulle part (ni device, ni serveur)// DÉRIVATION DES CLÉS PAR CATÉGORIEseed + ctx='relais_comptes_v1' → Argon2id → K1seed + ctx='relais_messages_v1' → Argon2id → K2seed + ctx='relais_finances_v1' → Argon2id → K3 → K1, K2, K3 existent uniquement en mémoire vive → Totalement indépendants mathématiquementBase locale SQLite créée sur le device → Trois tables chiffrées : comptes, messages, finances → Chacune chiffrée avec sa Ki respective → Vide à ce stade// BACKUP IMMÉDIAT SUR STORJ (indépendant de la transmission)P1_1, P1_2, P1_3 → HCV Transit → P2_1, P2_2, P2_3 → Storj → Permet la restauration multi-device dès la créationL'utilisateur définit un mot de passe local (confort quotidien) → mot de passe → Argon2id → K_login → K_login permet de dériver K1 K2 K3 à chaque ouverture// Compte créé. Transmission PAS encore activée. |

## 4.2 Cycle de vie — Saisie et chiffrement local des données
Ce qui se passe quand l'utilisateur ajoute un compte ou une information dans l'app.
| L'utilisateur tape ses données dans l'app → Choisit la catégorie : Comptes / Messages / Finances D = { nom: 'Netflix', login: '...', mdp: '...', instructions: '...' } → D existe en clair uniquement en mémoire viveApp chiffre immédiatement D avec la Ki correspondante Catégorie Comptes : XChaCha20-Poly1305(K1, D) → P1_1 Catégorie Messages : XChaCha20-Poly1305(K2, D) → P1_2 Catégorie Finances : XChaCha20-Poly1305(K3, D) → P1_3 → D en clair détruit de la mémoire après chiffrementPi_1 écrit dans la table SQLite correspondante (base locale) → D en clair ne touche jamais le disque ✅Sync Storj déclenchée automatiquement → Pi_1 → HCV → Pi_2 → Storj (backup mis à jour) |

## 4.3 Cycle de vie — Création des clés (activation de la transmission)
Ce qui se passe quand l'utilisateur configure ses trusted contacts et active la transmission. C'est ici que S1, S2, K_A et K_B sont créés.
| L'utilisateur désigne M trusted contacts (minimum 2) → Choisit le schéma N-of-M (ex: 2-of-3) → Pour chaque contact : 3 questions secrètes + rôle(s) → Désigne le data recipient par catégorie → Questions stockées en PostgreSQL (texte uniquement) → Réponses JAMAIS stockées// DÉCOUPE DE CHAQUE Ki SELON SON SCHÉMA// (répété pour K1, K2, K3 indépendamment)K1 → Shamir N-of-M → S1_1, S1_2, ... S1_MK2 → Shamir N-of-M → S2_1, S2_2, ... S2_MK3 → Shamir N-of-M → S3_1, S3_2, ... S3_M// PROTECTION DE CHAQUE PART// Pour chaque contact i ayant accès à la catégorie j :Argon2id(réponses_contact_i) → K_i (clé éphémère)XChaCha20(K_i, Sj_i) → Sj_i_enc (stocké PostgreSQL)K_i détruite immédiatement après chaque chiffrement// VERIFICATION TOKEN (par contact — pour révision annuelle)XChaCha20(K_i, "RELAIS_VERIFY_OK") → verify_token_i → verify_token_i stocké en PostgreSQL (~40 bytes) → Permet à l'owner de vérifier ses réponses sans déchiffrer le vault → K_i détruite immédiatement après création du token// Un contact avec plusieurs rôles reçoit plusieurs parts// Ex: Contact A (Gestionnaire + Gardien) reçoit S1_1_enc ET S2_1_enc// Déchiffrables avec la même K_A (mêmes réponses) |

## 4.4 Cycle de vie — Upload (device → Storj)
Ce qui se passe quand P1 est poussé vers le backup chiffré sur Storj.
| // Déclenché automatiquement à chaque modification du contenu// Indépendant de l'activation de la transmissionP1_1, P1_2, P1_3 lus depuis SQLite local → Envoyés au serveur Relais (toujours chiffrés, jamais D)Serveur Relais appelle API HCV Transit pour chaque Pi_1 → HCV chiffre Pi_1 avec sa propre clé → Pi_2 → Pi_1 détruit côté serveur immédiatement aprèsP2_1, P2_2, P2_3 envoyés vers Storj → Chaque Pi_2 fragmenté sur N noeuds distribués → Aucun noeud ne détient un Pi_2 en entier// Si_enc ne passent PAS par HCV// Déjà protégés par les Ki éphémères// Stockés directement en PostgreSQL |

## 4.5 Cycle de vie — Accès quotidien par l'utilisateur (pré-mortem)
Ce qui se passe quand l'utilisateur ouvre l'app normalement pour consulter ou modifier ses données.
| Utilisateur entre son mot de passe local → Argon2id(mot de passe) → K_login → K_login permet de recalculer K1, K2, K3 en mémoire viveApp lit P1_1, P1_2, P1_3 depuis SQLite local (sur le device) → Aucun téléchargement depuis Storj → Aucun appel réseauXChaCha20(K1, P1_1) → D1 (comptes & accès)XChaCha20(K2, P1_2) → D2 (messages)XChaCha20(K3, P1_3) → D3 (finances) → D1 D2 D3 affichés dans l'app → Existent uniquement en mémoire viveÀ la fermeture de l'app → K1, K2, K3 détruites de la mémoire vive → D1, D2, D3 détruits de la mémoire vive → Pi_1 restent sur le disque (chiffrés) ✅ |

## 4.6 Cycle de vie — Restauration sur un nouveau device
Ce qui se passe quand l'utilisateur perd ou change de téléphone.
| Utilisateur installe l'app sur nouveau device → Entre ses 12 mots BIP39 → seed → Argon2id(ctx='relais_comptes_v1') → K1 → seed → Argon2id(ctx='relais_messages_v1') → K2 → seed → Argon2id(ctx='relais_finances_v1') → K3App télécharge P2_1, P2_2, P2_3 depuis Storj → Appel API HCV Transit : déchiffre chaque Pi_2 → Pi_1 → Pi_2 détruits côté serveur après déchiffrementPi_1 écrits dans nouvelle SQLite locale → Base locale reconstituée ✅Utilisateur définit un nouveau mot de passe local// S1_enc, S2_enc non touchés — transmission inchangée |

## 4.7 Cycle de vie — Reconstitution des clés (post-mortem)
Ce qui se passe quand le dead man's switch se déclenche et que les contacts reconstituent K.
| // DÉCLENCHEMENTDead man's switch activé après silence prolongé → N tentatives de relance sans réponse (configurables) → Serveur envoie email à tous les M contacts Email : message personnel + lien app uniquement Pas de données sensibles dans l'email// CHAQUE CONTACT (asynchrone, dans n'importe quel ordre)Contact i clique le lien → ouvre l'app → App affiche les 3 questions secrètes → Contact i répond aux questions → Argon2id(réponses_i) → K_i en mémoire vive Pour chaque catégorie j dont le contact i a le rôle : → App récupère Sj_i_enc depuis PostgreSQL → XChaCha20(K_i, Sj_i_enc) → Sj_i → K_i détruite immédiatement → Sj_i re-chiffré clé session tmp → Sj_i_tmp → Sj_i_tmp déposé en escrow PostgreSQL (TTL 72h)// RECONSTITUTION QUAND N PARTS DISPONIBLES// Dès que N parts Sj_x sont en escrow pour une catégorie j :Sj_1_tmp + Sj_2_tmp + ... (N parts) → Shamir → Kj reconstituée ✅ → Parts déchiffrées depuis escrow en mémoire vive → Escrow vidé immédiatement après reconstitution |

## 4.8 Cycle de vie — Download et déchiffrement final (post-mortem)
Ce qui se passe quand K est reconstituée et que les données sont transmises au data recipient. Tout se passe sur le device du recipient.
| // K1, K2, K3 sont en mémoire vive sur le device du dernier contact// qui a complété le schéma N-of-MPour chaque catégorie j : App télécharge Pi_2 depuis Storj → Fragments reconstitués sur le device → Appel API HCV Transit : déchiffre Pi_2 → Pi_1 → XChaCha20(Kj, Pi_1) → Dj en clair → Dj existe uniquement en mémoire vive ✅ → Rien ne transite en clair sur le réseau ✅Dj transmis au data recipient désigné pour la catégorie j → Affiché dans l'app du recipient → Recipient peut exporter localement si besoin// NETTOYAGE IMMÉDIAT — catégorie par catégoriePi_2 supprimé de StorjSj_i_enc supprimés de PostgreSQL pour tous les contacts iEscrow Sj_i_tmp supprimé de PostgreSQLKj détruite de la mémoire vivePostgreSQL → statut 'transmis' + timestamp par catégorie// Seul le log de transmission est conservé (preuve légale) |

# 7. Avertissements onboarding et révision annuelle
Cette section couvre deux mécanismes distincts : les avertissements à afficher à l'utilisateur lors de la création du compte, et la vérification annuelle que l'owner se souvient encore des réponses définies pour ses contacts.
## 7.1 Avertissements obligatoires dans l'onboarding
Ces écrans sont non-passables (pas de bouton 'Passer') et doivent être affichés lors de la création du compte, après la génération des 12 mots.
Avertissement 1 — Les 12 mots sont irremplaçables
| Ces 12 mots sont la clé de votre coffre. Si vous les perdez et oubliez votre mot de passe, votre compte ne pourra plus jamais être restauré — même par Relais. Notez-les maintenant dans un endroit physique et sûr. |

- Affiché immédiatement après la génération des 12 mots
- L'user doit cocher : 'J'ai bien noté mes 12 mots dans un endroit physique sûr'
- Copier/coller désactivé sur cet écran
- Pas de bouton Passer
Avertissement 2 — La responsabilité du choix des contacts
| Si vos contacts de confiance ne peuvent pas répondre correctement aux questions secrètes, et que vos 12 mots sont introuvables, vos informations seront définitivement inaccessibles. Choisissez des contacts fiables et des questions dont vous êtes certain qu'ils se souviendront. |

- Affiché lors de la configuration de la transmission, avant l'activation
- L'user doit cocher : 'Je comprends que Relais ne peut pas contourner ces questions'
- Lien vers la FAQ : 'Que se passe-t-il si mes contacts ne trouvent pas ?'
Avertissement 3 — Ce que Relais peut et ne peut pas faire
| Relais PEUT faire | Relais NE PEUT PAS faire |
| Réinitialiser les tentatives échouées d'un contact | Voir le contenu de votre vault |
| Étendre le délai de l'escrow | Contourner les questions secrètes |
| Confirmer que les emails ont bien été envoyés | Déchiffrer vos données sans vos clés |
| Guider vos proches vers vos 12 mots physiques | Récupérer vos données si les 12 mots sont perdus |

## 7.2 Vérification annuelle des réponses — verify_token
Problème résolu
L'owner définit les réponses pour ses contacts mais peut, avec le temps, ne plus se souvenir de la formulation exacte utilisée. Exemple : 'Mathieu' vs 'Mathieu Mbida'. La vérification annuelle lui permet de détecter ce problème avant qu'il ne soit trop tard.
Mécanisme cryptographique
| // À LA CONFIGURATION DES QUESTIONS (setup)Owner saisit les réponses pour Contact i → Argon2id(réponses_i concaténées) → K_i éphémère → XChaCha20(K_i, "RELAIS_VERIFY_OK") → verify_token_i → verify_token_i stocké en PostgreSQL (~40 bytes) → K_i détruite immédiatement → Les réponses elles-mêmes ne sont JAMAIS stockées// LORS DE LA RÉVISION ANNUELLE (check-in)App affiche les questions définies pour Contact iOwner re-saisit les réponses telles qu'il les a définies → Argon2id(réponses saisies) → K_i_test → Tente de déchiffrer verify_token_i avec K_i_test → XChaCha20-Poly1305 retourne : succès → plaintext == "RELAIS_VERIFY_OK" → réponses correctes ✓ erreur → authentication failed → réponses incorrectes ✗ → K_i_test détruite immédiatement// AVANTAGE vs hash brut stockéHash brut → attaquable par brute force hors ligne si BD voléeverify_token → XChaCha20-Poly1305 détecte tout mauvais déchiffrement — pas d'information exploitable |

Stockage
| Champ | Type | Description |
| verify_token_i | BYTEA ~40 bytes | Un par trusted contact. Recréé si les questions changent. |
| verify_last_checked_at | TIMESTAMP | Date de la dernière vérification réussie par l'owner. |

User Story associée
| E3-US08 (P1 — Haute) — En tant qu'utilisateur, lors de mon check-in annuel, je veux pouvoir vérifier que je me souviens encore des réponses définies pour mes contacts, afin de les mettre à jour avant qu'il soit trop tard. |

Règles UX
- La vérification annuelle est proposée — pas imposée — lors du check-in
- Si la vérification échoue : option immédiate de redéfinir les questions + réponses
- Si les questions changent : verify_token_i et Si_enc sont tous les deux recréés
- Maximum 3 tentatives avant message d'aide — pas de blocage sur cette vérification
# 8. Sécurité du compte
La sécurité du compte est distincte de la sécurité du vault. Elle protège l'accès à l'application, pas les données elles-mêmes.
## 7.1 Inscription
| Champ | Obligatoire | Remarque |
| Prénom + Nom | Oui | Personnalisation de l'expérience |
| Email | Oui | Identifiant principal — vérifié par OTP à 6 chiffres |
| Numéro de téléphone | Oui | Collecté dès V1. Utilisé pour 2FA SMS en V2. |
| Mot de passe | Oui | Dérive K1 K2 K3 via Argon2id |
| Adresse | Non | Inutile fonctionnellement — non collectée |

Vérification email : OTP à 6 chiffres envoyé à l'inscription. Pratique standard sur mobile.
KYC : non prévu en V1. Relais ne gère pas d'argent. La friction est incompatible avec l'objectif d'adoption.
## 7.2 Authentification quotidienne
| Niveau | Mécanisme | Usage |
| Niveau 1 | Biométrie (Face ID / empreinte) | Déverrouille l'app. Rapide, sans friction. |
| Niveau 2 — Fallback | PIN à 6 chiffres | Si biométrie indisponible ou échoue. |
| Niveau 3 — Critique | Mot de passe complet | Restauration, réinitialisation, actions sensibles. |

Le PIN et la biométrie déverrouillent l'app localement. Ils ne remplacent pas le mot de passe. Le mot de passe est la seule source de dérivation de K1 K2 K3.
## 7.3 Gestion des sessions
| Situation | Comportement |
| Session active | Biométrie ou PIN suffisent pour ouvrir l'app |
| Inactivité > 3 mois | Déconnexion automatique. Mot de passe complet requis à la reconnexion. |
| Nouveau device | Mot de passe complet + 2FA obligatoire |
| Comportement suspect | 2FA déclenché automatiquement |

Cohérence intentionnelle : 3 mois d'inactivité déclenche simultanément la déconnexion et les premières relances du check-in mensuel. Les deux mécanismes sont alignés.
## 7.4 Actions sensibles — PIN requis
- Modifier les trusted contacts
- Changer la configuration de la transmission
- Désactiver le dead man's switch
- Afficher à nouveau les 12 mots BIP39
- Changer le mot de passe
## 7.5 Double authentification (2FA)
| Mécanisme | Statut | Remarque |
| TOTP (Google Authenticator / Authy) | V1 — optionnel | Activable dans les paramètres. Aucun coût. Fonctionne hors ligne. |
| SMS OTP | V2 | Reporté — coût opérateur. Numéro collecté dès V1. |
| Email OTP | Jamais | Trop lent, risque spam, mauvaise UX mobile. |

# 9. Garanties de sécurité
| Scénario d'attaque | Ce que l'attaquant obtient | Résultat |
| Serveurs Relais piratés | P2 + S1_enc + S2_enc + metadata | P2 illisible sans HCV. S1_enc/S2_enc illisibles sans réponses aux questions. |
| HCV piraté | Accès au Transit Engine | P1 illisible sans K. K inconnue de HCV. |
| Storj piraté | Fragments de P2 | Fragments incomplets + P2 doublement chiffré. |
| Contact A malveillant seul | S1 | S1 seul ne reconstitue pas K. S2 manquant. |
| Contact B malveillant seul | S2 | S2 seul ne reconstitue pas K. S1 manquant. |
| Dev Relais avec accès root | P2 + S1_enc + S2_enc | Bloqué par HCV. Ne peut pas déchiffrer P2 sans appel HCV loggé. |
| Interception réseau | P1 ou P2 en transit | Toujours chiffré. D ne transite jamais en clair. |
| Brute force des réponses | Tentatives sur K_A/K_B | Argon2id rend chaque tentative coûteuse en temps et mémoire. |

# 10. Infrastructure
| Service | Rôle | Version initiale |
| PostgreSQL | Metadata, questions, S1_enc, S2_enc, escrow, logs | Managed (ex: Supabase ou Railway) |
| Storj | Stockage distribué de P2 | Storj DCS (S3-compatible) |
| HashiCorp Vault | Transit Secrets Engine — chiffrement P1→P2 | HCP Vault Dedicated (V1), OpenBao self-hosted (V2) |
| React Native | App mobile iOS + Android | Expo ou bare workflow |
| Node.js | API serveur Relais | Express ou Fastify |
| libsodium | XChaCha20, Argon2id, Shamir côté client | libsodium-wrappers (JS/React Native) |

— Fin des Specs Techniques v1.0 —
Prochaines étapes : Flowcharts, User Stories, Wireframes
