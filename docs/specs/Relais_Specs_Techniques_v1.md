RELAIS
Passe le relais, pas le chaos.
Specs Techniques — Version 1.2
v1.2 — Corrections DEC-20 à DEC-27 intégrées.
Avril 2026 — Confidentiel
# Changelog v1.2
| Ce document reprend intégralement les Specs Techniques v1.1. Les sections modifiées sont marquées [v1.2]. Les sections inchangées sont listées pour référence. |

| Section | Changement |
| §1 Vocabulaire | secret_enc redéfini : { nom, rôle, message_personnel } uniquement. questions_id_i ajouté. |
| §4.3 Création des clés | Flow de configuration contacts corrigé : questions = question_id, pas dans secret_enc |
| §4.7 Reconstitution | Flow relay corrigé : contact obtient les questions via /relay/:token → checkin_questions |
| §8.2 Auth — Blocage PIN | Backoff progressif documenté (DEC-26) |
| §8.4 Actions sensibles | Liste complète des actions step-up (DEC-25) |

# §1 — Vocabulaire [v1.2]
Termes modifiés par rapport à v1.1.
| Terme | Définition v1.2 |
| secret_enc | { nom, rôle, message_personnel } du contact chiffré avec K2 de l'owner. v1.2 : les questions secrètes ne sont PLUS dans secret_enc — elles sont des références vers checkin_questions. |
| question_id_i | Référence UUID vers checkin_questions pour chacune des 3 questions d'un contact. Stockée en clair dans trusted_contacts (le texte est public — bibliothèque admin). Permet au contact de voir ses questions via /relay/:token sans déchiffrement. |

# §4.3 — Création des clés : configuration contacts [v1.2]
| DEC-20 : Les questions secrètes sont des références vers la bibliothèque publique checkin_questions. Leur texte est public. Ce qui reste dans secret_enc : uniquement nom, rôle, message_personnel. |

| // CONFIGURATION D'UN TRUSTED CONTACT (activation transmission)// NIVEAU 1 — notification_enc (inchangé)notification_enc = XChaCha20(relais_public_key, { email, phone })notification_sig = Ed25519.sign(notification_enc, owner_sk)// NIVEAU 2 — secret_enc (v1.2 : sans les questions)secret_enc = XChaCha20(K2_owner, { nom: 'Hervé Nguemne', role: 'gestionnaire', message_personnel: 'Hervé, si tu lis ceci...' // ✗ questions retirées de secret_enc (DEC-20)})// DEC-20 — Questions = références bibliothèque (texte public)// L'owner choisit 3 questions dans la bibliothèque administrée// Stockées en clair dans trusted_contacts :question_1_id = 'uuid-question-A' // ex: 'Prénom meilleur ami 6e'question_2_id = 'uuid-question-B' // ex: 'Rue grand-mère maternelle'question_3_id = 'uuid-question-C' // ex: 'Film en boucle avec père'// VERIFY TOKEN (inchangé — dérivé des réponses, pas des questions)K_i = Argon2id(réponses_contact_i concaténées)verify_token_i = XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1')// PARTS SHAMIR (inchangé)K1 → Shamir → S1_i_enc = XChaCha20(K_i, S1_i) → Storj |

# §4.7 — Flow relay : reconstitution post-mortem [v1.2]
| DEC-20 : Le contact obtient le texte de ses questions via l'API /relay/:token. L'app charge les libellés depuis checkin_questions (texte public). Aucun déchiffrement requis pour afficher les questions. |

| // CÔTÉ CONTACT — flow complet post-mortem1. Contact reçoit l'email avec lien /relay/:token2. Ouvre l'app → GET /relay/:token ← Serveur retourne : { question_1: { id, text_fr, text_en }, // depuis checkin_questions question_2: { id, text_fr, text_en }, question_3: { id, text_fr, text_en }, roles: { k1: bool, k2: bool, k3: bool } }// Aucun déchiffrement pour afficher les questions ✅// Le texte vient de la bibliothèque publique3. Contact saisit ses 3 réponses4. App dérive K_i = Argon2id(réponses concaténées)5. App télécharge Si_enc depuis Storj6. XChaCha20_decrypt(K_i, Si_enc) → Si (Poly1305 valide = réponses OK)7. Si re-chiffré clé session Redis → Si_tmp → escrow PostgreSQL// Si trop d'échecs (fail_count >= 5) → contact bloqué 24h// Vérification 100% côté client — Relais ne sait pas si les réponses// sont correctes, seulement que le contact a téléchargé Si_enc ✅ |

# §8.2 — Blocage PIN : backoff progressif [v1.2]
| DEC-26 : Backoff progressif au lieu d'un blocage fixe. Configuré dans app_config (security.pin_backoff_steps). Implémenté 100% côté client dans PIN Gate (frontend specs §4.3). |

| Tentative | Durée de blocage | Configurable |
| 1 à 5 | Libre — pas de blocage | — |
| 6 | 30 secondes | security.pin_backoff_steps[0] |
| 7 | 2 minutes | security.pin_backoff_steps[1] |
| 8 | 10 minutes | security.pin_backoff_steps[2] |
| 9 et + | 30 minutes | security.pin_backoff_steps[3] |

Le vrai rempart contre le brute force est Argon2id, pas le délai. Le backoff progressif protège l'utilisateur légitime qui hésite sans être excessivement punitif.
# §8.4 — Actions sensibles : liste complète [v1.2]
| DEC-25 : Liste canonique des actions step-up. Endpoint : POST /auth/pin/step-up. Header : X-Step-Up-Token. |

| Action code | Endpoint protégé | Description |
| edit_transmission | PUT /transmission/config | Modifier la configuration DMS |
| activate_transmission | POST /transmission/activate | Activer le dead man's switch |
| delete_transmission | DELETE /transmission | Désactiver la transmission |
| edit_contacts | PUT/DELETE /transmission/contacts/:id | Modifier ou supprimer un contact |
| change_password | PUT /auth/password | Changer le mot de passe |
| view_seed | POST /auth/seed/display | Réafficher les 12 mots (DEC-27 : POST, pas GET) |
| disable_2fa | DELETE /auth/2fa | Désactiver le TOTP |
| admin_action | POST /admin/* | Toutes les actions back office |

| DEC-27 : L'endpoint est POST /auth/seed/display (pas GET /auth/seed-words). Le serveur ne stocke jamais le seed — il retourne juste un 200 OK qui autorise l'app à afficher seed_enc_pin déchiffré localement. |

— Fin des modifications Specs Techniques v1.2 — Toutes les autres sections de v1.1 restent inchangées.
