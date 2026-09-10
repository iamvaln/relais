RELAIS
Passe le relais, pas le chaos.
Backend Specs — Version 1.1
v1.1 — §3.3 vault réécrit, step-up unifié (DEC-25), endpoint seed renommé (DEC-27).
Avril 2026 — Confidentiel
# Changelog v1.1
| Section | Changement |
| §3.3 Vault | Endpoints /vault/accounts, /vault/summary supprimés (DEC-21 — vault purement local). Reste : /vault/sync, /vault/restore, /vault/sync-status. |
| §3.1 Auth | GET /auth/seed-words → POST /auth/seed/display (DEC-27). GET /auth/restore/challenge et POST /auth/restore/verify ajoutés. |
| §2.5 Step-up | Dupliqué 3 fois en v1.0 avec variantes divergentes. Canonique : POST /auth/pin/step-up + X-Step-Up-Token. Liste actions complète. |
| §3.7 Relay | GET /relay/:token retourne maintenant question_1/2/3 depuis checkin_questions (DEC-20). |

# §2.5 — Step-up token [canonique v1.1]
| Version canonique unique. Les deux autres occurrences de cette section en v1.0 sont supprimées. DEC-25. |

| // Endpoint unique :POST /auth/pin/step-up Body: { action: StepUpAction } Auth: Bearer <access_token> requis Returns: { step_up_token, action, exp }// Header sur les endpoints protégés :X-Step-Up-Token: <step_up_token>// Actions valides :type StepUpAction = | 'edit_transmission' // PUT /transmission/config | 'activate_transmission'// POST /transmission/activate | 'delete_transmission' // DELETE /transmission | 'edit_contacts' // PUT/DELETE /transmission/contacts/:id | 'change_password' // PUT /auth/password | 'view_seed' // POST /auth/seed/display | 'disable_2fa' // DELETE /auth/2fa | 'admin_action' // POST /admin/*// Sécurité :// JWT signé JWT_STEPUP_SECRET (dédié, différent de JWT_ACCESS_SECRET)// TTL : 5 minutes// Usage unique — jti blacklisté en Redis après utilisation// Rate limit : 10 req/min par user |

# §3.1 — Auth endpoints [v1.1]
| POST /auth/register → Créer un comptePOST /auth/login → Se connecterPOST /auth/logout → Se déconnecterPOST /auth/refresh → Renouveler l'access tokenPOST /auth/email/verify → Valider OTP emailPOST /auth/email/resend-otp → Renvoyer OTP emailPOST /auth/password/reset-request → Demander reset mot de passePOST /auth/password/reset → Réinitialiser mot de passePUT /auth/password → Changer mot de passe (step-up requis)POST /auth/2fa/setup → Générer QR code TOTPPOST /auth/2fa/verify → Valider code TOTPDELETE /auth/2fa → Désactiver 2FA (step-up requis)POST /auth/pin/step-up → Obtenir step-up token après PIN local-- Restauration (DEC-06)GET /auth/restore/challenge → Obtenir challenge Ed25519 (32 bytes, TTL 5min)POST /auth/restore/verify → Vérifier signature Ed25519 du challenge-- Seed (DEC-27 : POST pas GET, serveur n'a jamais le seed)POST /auth/seed/display → Autoriser l'app à afficher seed_enc_pin local -- step-up 'view_seed' requis -- Retourne { authorized: true } uniquement -- L'app déchiffre seed_enc_pin localement |

# §3.3 — Vault [v1.1 — réécrit]
| DEC-21 : Le vault est purement local (SQLite) + blob Storj opaque. PostgreSQL ne stocke aucune métadonnée de vault. /vault/accounts, /vault/summary et /vault/accounts/:id sont supprimés. La limite vault.free_max_accounts = 5 est appliquée côté client uniquement. |

| // Endpoints SUPPRIMÉS (DEC-21)// ✗ GET /vault/summary// ✗ GET /vault/accounts// ✗ POST /vault/accounts// ✗ PUT /vault/accounts/:id// ✗ DELETE /vault/accounts/:id// ✗ (idem pour /vault/messages et /vault/finances)// Endpoints CONSERVÉSPOST /vault/sync -- Push P2 signé vers Storj Body: { category: 'accounts'|'messages'|'finances', payload: base64(P2), // P2 = XChaCha20(Ki, P1) côté client signature: base64(Ed25519.sign(SHA256(P1), ed25519_sk)) } Serveur : 1. Vérifie signature avec ed25519_pk (depuis users table) 2. Si valide → stocke P2 sur Storj à storj_vault_path 3. Met à jour transmission_configs.storj_vault_path si premier sync 4. Logue dans email_log (optionnel) — non, c'est un sync pas un email Returns: { synced_at, storj_path }GET /vault/sync-status -- Statut de la dernière sync par catégorie Returns: { accounts: { synced_at, storj_path }, messages: { ... }, finances: { ... } }POST /vault/restore -- Pull P2 depuis Storj pour restauration sur nouveau device Body: { category: 'accounts'|'messages'|'finances' } Serveur : télécharge P2 depuis Storj → retourne à l'app App : déchiffre P2 avec Ki → P1 → SQLite local Returns: { payload: base64(P2) }// NOTE : le serveur ne sait pas combien de comptes l'user a.// La limite free_max_accounts = 5 est vérifiée dans l'app// avant chaque ajout (depuis le count SQLite local). |

# §3.7 — Relay (trusted contacts) [v1.1]
| DEC-20 : GET /relay/:token retourne maintenant les textes de questions depuis checkin_questions. Le contact n'a pas besoin de déchiffrer quoi que ce soit pour voir ses questions. |

| GET /relay/:token -- Vérifier validité token + récupérer questions et rôles Returns: { valid: true, expires_at: timestamp, // DEC-20 : questions depuis checkin_questions (texte public) questions: [ { id: uuid, text_fr: '...', text_en: '...' }, { id: uuid, text_fr: '...', text_en: '...' }, { id: uuid, text_fr: '...', text_en: '...' }, ], roles: { k1: bool, k2: bool, k3: bool }, schema: { n: int, m: int }, contacts_answered: int, // combien ont déjà répondu }POST /relay/:token/verify -- Le contact soumet ses réponses -- La vérification se fait 100% CÔTÉ CLIENT -- Ce endpoint ne reçoit PAS les réponses en clair Body: { share_enc: base64(Si_tmp_enc) } -- L'app a déjà déchiffré Si_enc avec K_i (réponses) côté client -- Elle envoie Si re-chiffré avec clé de session Redis Serveur : stocke dans escrow_shares (TTL 72h) Returns: { accepted: true, shares_remaining: int }GET /relay/:token/status Returns: { status, contacts_answered, contacts_needed }GET /relay/:token/data -- Disponible uniquement quand N contacts ont répondu -- Retourne P2 pour les catégories du rôle de ce contact Returns: { payload_k1: base64(P2_1) | null, payload_k2: base64(P2_2) | null, payload_k3: base64(P2_3) | null }POST /relay/:token/confirm -- Contact confirme avoir reçu et traité les données -- Déclenche le nettoyage Storj Returns: { confirmed: true } |

— Fin des modifications Backend Specs v1.1 — Toutes les autres sections de v1.0 restent inchangées.
