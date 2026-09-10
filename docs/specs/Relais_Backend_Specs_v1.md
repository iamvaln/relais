RELAIS
Passe le relais, pas le chaos.
Backend Specs — Version 1.0
Avril 2026 — Confidentiel
# 1. Architecture générale
## 1.1 Stack technique
| Couche | Technologie | Justification |
| Runtime | Node.js 22 LTS | Écosystème riche, async natif, libsodium disponible |
| Framework API | Fastify | Plus rapide qu'Express, meilleur support TypeScript, schema validation natif |
| Langage | TypeScript strict | Sécurité des types, meilleure maintenabilité en solo |
| ORM | Prisma | Type-safe, migrations gérées, compatible PostgreSQL |
| File d'attente | BullMQ + Redis | Jobs asynchrones fiables — dead man's switch, emails, nettoyages |
| Cache | Redis | Sessions, rate limiting, états temporaires |
| Tests | Vitest + Supertest | Tests unitaires + intégration API |

## 1.2 Principes de design
- Stateless — chaque requête est autonome, aucun état en mémoire serveur
- Zero-knowledge by design — le serveur ne manipule jamais de données déchiffrées
- Fail secure — en cas d'erreur, on refuse plutôt qu'on autorise
- Single responsibility — un service = une responsabilité
- Audit trail — toute action sensible est loggée de façon immuable
## 1.3 Structure des services
| src/├── api/ # Routes et controllers Fastify│ ├── auth/ # Authentification et sessions│ ├── vault/ # Gestion du vault (metadata uniquement)│ ├── transmission/ # Configuration et déclenchement│ ├── checkin/ # Check-in et carnet de vie│ ├── journal/ # Entrées du carnet et Wrapped│ └── admin/ # Routes back office├── jobs/ # Jobs BullMQ asynchrones│ ├── deadman/ # Dead man's switch et relances│ ├── cleanup/ # Nettoyage escrows et données expirées│ └── notifications/ # Envoi emails├── services/ # Logique métier│ ├── crypto/ # Wrappers libsodium + HCV Transit│ ├── storj/ # Upload/download P2│ ├── email/ # Templates et envoi│ └── audit/ # Logs immuables├── middleware/ # Auth, rate limiting, validation├── prisma/ # Schema BD et migrations└── config/ # Variables d'environnement |

| 2 — Authentification & AutorisationJWT sans état, sessions Redis, middleware de sécurité. |

## 2.1 Stratégie d'authentification
Relais utilise deux tokens complémentaires :
| Token | Durée | Stockage client | Usage |
| Access Token (JWT) | 15 minutes | Mémoire vive (jamais localStorage) | Autoriser les requêtes API |
| Refresh Token | 3 mois (durée session) | HttpOnly cookie sécurisé | Renouveler l'access token |

| Les tokens ne contiennent jamais de données sensibles — uniquement user_id, plan, iat, exp. K1/K2/K3 ne transitent jamais dans un token. |

## 2.2 Flow d'authentification
| // LOGINPOST /auth/login Body: { email, password } → Vérifie email + Argon2id(password) → Si 2FA activé : renvoie { requires_2fa: true, temp_token } → Sinon : renvoie { access_token } + set refresh_token cookie// 2FA TOTPPOST /auth/2fa/verify Body: { temp_token, totp_code } → Vérifie le code TOTP → Renvoie { access_token } + set refresh_token cookie// REFRESHPOST /auth/refresh Cookie: refresh_token → Vérifie le refresh token → Renvoie nouveau { access_token }// LOGOUTPOST /auth/logout → Invalide le refresh token en base → Clear le cookie |

## 2.3 Middleware d'autorisation
| // Ordre du middleware stack sur chaque requête1. rateLimiter → bloque si trop de requêtes2. authenticate → vérifie access_token JWT3. requirePlan → vérifie le plan (gratuit/premium)4. requirePin → exige PIN pour actions sensibles5. auditLogger → log l'action avant exécution6. handler → logique métier// requireStepUp déclenché sur :→ PUT /transmission/config (step-up action: edit_transmission)→ DELETE /transmission (step-up action: delete_transmission)→ PUT /transmission/contacts/:id (step-up action: edit_contacts)→ GET /auth/seed-words (step-up action: view_seed)→ PUT /auth/password (step-up action: change_password)→ POST /admin/* (step-up action: admin_action)// IMPORTANT : Le PIN ne transite JAMAIS sur le réseau.// Il est vérifié localement sur le device.// Le serveur reçoit uniquement le step-up token comme preuve. |

## 2.4 Step-up token — PIN côté client
| Le PIN est dérivé et vérifié exclusivement sur le device. Il ne transite jamais sur le réseau. Le serveur émet un step-up token en faisant confiance au fait que l'app a bien validé le PIN localement. |

| // FLOW COMPLET DU STEP-UP TOKEN1. User déclenche une action sensible (ex: modifier les contacts)2. App affiche l'écran PIN/biométrie → PIN validé localement — K1/K2/K3 accessibles en mémoire → Si PIN incorrect : refus immédiat, AUCUNE requête réseau → Le compteur d'échecs PIN est géré localement3. App appelle POST /auth/stepup Headers: { Authorization: Bearer <access_token> } Body: { action: 'edit_contacts' } → Le serveur vérifie uniquement l'access token → Le serveur émet un step-up JWT (5 min, action-specific) { stepup_token, action: 'edit_contacts', exp: now+5min }4. App appelle PUT /transmission/contacts/:id Headers: { X-Stepup-Token: <stepup_token> } → requireStepUp middleware vérifie : - Signature JWT valide - Non expiré (5 min max) - action correspond à l'endpoint appelé → Action autorisée ✅// Actions nécessitant un step-up tokenedit_contacts → PUT/DELETE /transmission/contacts/*edit_transmission → PUT/DELETE /transmission/configview_seed → GET /auth/seed-wordschange_password → PUT /auth/passwordadmin_action → POST /admin/* (toutes les routes admin)// Sécurité du step-up token→ JWT signé avec secret dédié JWT_STEPUP_SECRET→ Durée de vie : 5 minutes maximum→ Non renouvelable — nouvel écran PIN requis après expiration→ Usage unique recommandé — invalidé après première utilisation→ Rate limit : 10 stepup/min par user |

## 2.5 Gestion des blocages
| Situation | Comportement | Déblocage |
| 5 tentatives PIN échouées | Compte bloqué 30 min. Compteur en Redis. | Automatique après 30 min ou admin |
| 5 tentatives mot de passe échouées | Compte bloqué 15 min. Email de notification. | Automatique après 15 min ou admin |
| 5 tentatives OTP échouées | OTP invalidé. Nouveau OTP requis. | Regénération manuelle ou admin |
| 5 tentatives questions contact | Contact bloqué 24h. Notif à l'owner si vivant. | Admin uniquement |
| Session inactive > 3 mois | Refresh token expiré. Reconnexion complète. | Login avec mot de passe complet |

## 2.5 Step-up token — mécanisme détaillé
| Le PIN est une protection locale — il ne transite jamais sur le réseau. Le serveur ne le connaît pas et ne doit pas le connaître. Le step-up token est une confiance déléguée : le client prouve qu'il a vérifié le PIN localement. |

| // FLOW COMPLET — Action sensible (ex: modifier les contacts)ÉTAPE 1 — Côté client (React Native) User déclenche l'action → pinGate('edit_contacts') affiché → User saisit PIN ou biométrie → Vérification locale : Argon2id(PIN) → K_login → recalcule K1/K2/K3 → Si K1 déchiffre un test local → PIN correct → Si échec → incrémente compteur local, bloque après 5 échecsÉTAPE 2 — Obtenir le step-up token POST /auth/pin/step-up Headers: { Authorization: Bearer <access_token> } Body: { action: 'edit_contacts' } → Serveur vérifie l'access token (identité prouvée) → Serveur émet un step-up JWT : { sub: user_id, action: 'edit_contacts', iat: now, exp: now + 5min, jti: uuid } → jti stocké en Redis pour empêcher la réutilisationÉTAPE 3 — Appel de l'action sensible PUT /transmission/contacts/:id Headers: { Authorization: Bearer <access_token> X-StepUp-Token: <step_up_token> } → requireStepUp middleware : Vérifie signature du step-up token Vérifie exp (< 5 min) Vérifie que action == 'edit_contacts' Vérifie que jti n'a pas déjà été utilisé (Redis) Invalide le jti immédiatement après (one-shot) → Action exécutée ✅// Propriétés du step-up token→ Durée de vie : 5 minutes→ Usage unique : jti invalidé après premier usage→ Action-specific : ne peut servir que pour l'action déclarée→ Rate limit : 10 demandes de step-up par minute par user |

## 2.5 Step-up token — mécanisme PIN côté serveur
| Le PIN ne transite JAMAIS sur le réseau. Il est vérifié entièrement sur le device client. Le serveur ne connaît pas le PIN et ne doit pas le connaître. Le step-up token est une délégation de confiance : le client atteste que le PIN a été validé localement. |

Flow complet
| 1. User déclenche une action sensible (ex : modifier ses contacts)2. App vérifie le PIN localement → PIN incorrect : refus immédiat, aucune requête réseau → PIN correct : K1/K2/K3 accessibles en mémoire vive3. App appelle POST /auth/pin/step-up Headers: Authorization: Bearer <access_token> Body: { action: 'edit_contacts' } → Le serveur vérifie l'access_token (identité) → Le serveur fait confiance : si l'access_token est valide, l'user est bien authentifié et a validé son PIN localement → Retourne: { step_up_token, action, exp: now + 5min }4. App appelle PUT /transmission/contacts/:id Headers: X-Step-Up-Token: <step_up_token> → requireStepUp middleware vérifie : - step_up_token valide et non expiré - action dans le token correspond à l'endpoint - step_up_token pas déjà utilisé (one-time use) → Action autorisée ✅5. step_up_token invalidé après utilisation (Redis blacklist) |

Actions et leur step-up action code
| Endpoint | Action code requis |
| PUT /transmission/config | edit_transmission |
| DELETE /transmission | delete_transmission |
| POST /transmission/activate | activate_transmission |
| PUT /transmission/contacts/:id | edit_contacts |
| DELETE /transmission/contacts/:id | edit_contacts |
| PUT /transmission/schema | edit_contacts |
| PUT /transmission/recipients | edit_transmission |
| PUT /auth/password | change_password |
| GET /auth/seed-words | view_seed |
| DELETE /auth/2fa | disable_2fa |
| POST /admin/* | admin_action |

Sécurité du step-up token
- JWT signé avec secret dédié JWT_STEPUP_SECRET (différent de JWT_ACCESS_SECRET)
- Durée de vie : 5 minutes maximum
- Usage unique — invalidé en Redis après première utilisation
- Contient : user_id, action, iat, exp
- Rate limité : 10 POST /auth/pin/step-up par minute par user
- L'access_token doit être valide pour obtenir un step-up token
| 3 — API REST — EndpointsTous les endpoints par module. Format : MÉTHODE /chemin → description. |

| Convention de réponse : toutes les réponses suivent { success: bool, data: {} | null, error: { code, message } | null }. Les codes d'erreur sont définis en section 6. |

## 3.1 Auth
| POST /auth/register → Créer un comptePOST /auth/login → Se connecterPOST /auth/logout → Se déconnecterPOST /auth/refresh → Renouveler l'access tokenPOST /auth/email/verify → Valider OTP emailPOST /auth/email/resend-otp → Renvoyer OTP emailPOST /auth/password/reset-request → Demander reset mot de passePOST /auth/password/reset → Réinitialiser mot de passe (12 mots + nouveau mdp)PUT /auth/password → Changer mot de passe (PIN requis)POST /auth/2fa/setup → Générer QR code TOTPPOST /auth/2fa/verify → Valider code TOTP (activation ou login)DELETE /auth/2fa → Désactiver 2FA (PIN + TOTP requis)POST /auth/pin/step-up → Émettre un step-up token (PIN vérifié localement avant cet appel)GET /auth/seed-words → Réafficher les 12 mots (PIN requis, 1 fois) |

## 3.2 Profil utilisateur
| GET /user/profile → Récupérer le profilPUT /user/profile → Mettre à jour nom, languePUT /user/email → Changer email (PIN + OTP requis)PUT /user/phone → Changer numéro (PIN requis)DELETE /user/account → Supprimer le compte (PIN + confirmation)GET /user/sessions → Lister les sessions activesDELETE /user/sessions/:id → Révoquer une session |

## 3.3 Vault — Metadata
| Le serveur ne reçoit et ne stocke jamais D en clair. Il reçoit uniquement des blobs chiffrés (P1) qu'il transmet à HCV pour obtenir P2, puis push sur Storj. |

| // Metadata du vault (structure, pas le contenu)GET /vault/summary → Nb comptes par catégorie, statut syncPOST /vault/sync → Push P1 → HCV → P2 → StorjPOST /vault/restore → Pull P2 → HCV → P1 (restauration device)GET /vault/sync-status → Statut de la dernière sync// Catégorie comptesGET /vault/accounts → Liste des comptes (ID + metadata, pas contenu)POST /vault/accounts → Ajouter un compte (envoie P1_1 chiffré)PUT /vault/accounts/:id → Modifier un compteDELETE /vault/accounts/:id → Supprimer un compte// Même pattern pour /vault/messages et /vault/finances |

## 3.4 Transmission
| GET /transmission/config → Récupérer la config complètePOST /transmission/activate → Activer la transmission (PIN requis)PUT /transmission/config → Modifier config (PIN requis)DELETE /transmission → Désactiver (PIN requis)// ContactsGET /transmission/contacts → Lister les contactsPOST /transmission/contacts → Ajouter un contactPUT /transmission/contacts/:id → Modifier un contact (PIN requis)DELETE /transmission/contacts/:id → Supprimer un contact (PIN requis)POST /transmission/contacts/:id/verify → Vérification annuelle réponses (owner)// SchémaPUT /transmission/schema → Modifier N-of-M (PIN requis)// Mode pausePOST /transmission/pause → Activer le mode pause (PIN requis)DELETE /transmission/pause → Désactiver le mode pause// RecipientsPUT /transmission/recipients → Configurer qui reçoit quoi (PIN requis) |

## 3.5 Check-in
| GET /checkin/status → Statut du prochain check-inGET /checkin/game → Récupérer l'énigme/jeu du moisPOST /checkin/game/answer → Soumettre la réponse au jeuPOST /checkin/complete → Valider le check-in (après jeu réussi)GET /checkin/history → Historique des check-ins validésGET /checkin/streak → Streak actuel et badges débloqués |

## 3.6 Carnet de vie
| GET /journal/question → Question du mois courantPOST /journal/entries → Créer une entrée (envoie content_enc chiffré)GET /journal/entries → Lister les entrées (metadata, pas contenu)GET /journal/entries/:id → Récupérer une entrée (P1 pour déchiffrement local)PUT /journal/entries/:id → Modifier une entréeDELETE /journal/entries/:id → Supprimer une entrée// Wrapped annuelGET /journal/wrapped/:year → Récupérer le Wrapped d'une annéePOST /journal/wrapped/:year → Générer le Wrapped (déclenché localement)GET /journal/wrapped/:year/export → Métadonnées pour export image (local) |

## 3.7 Transmission côté contact (public — sans auth)
| Ces endpoints sont accessibles via un token unique à usage unique envoyé par email. Pas de compte requis pour les trusted contacts. |

| // Token unique envoyé par email au contactGET /relay/:token → Vérifier la validité du token + récupérer les questionsPOST /relay/:token/verify → Soumettre les réponses aux questions secrètesGET /relay/:token/status → Statut (en attente de l'autre contact, déverrouillé...)GET /relay/:token/data → Récupérer P2 une fois reconstitution complètePOST /relay/:token/confirm → Confirmer que la transmission est traitée// Limites strictes sur ces endpoints :→ Max 5 tentatives de réponses par token→ Token à usage unique — invalide après confirmation→ Rate limiting agressif : 3 req/min par IP |

## 3.8 Back office (admin)
| // Auth adminPOST /admin/auth/login → Login admin (email + mdp + TOTP obligatoire)POST /admin/auth/logout// UtilisateursGET /admin/users → Liste paginée avec filtresGET /admin/users/:id → Détail utilisateur (metadata uniquement)POST /admin/users/:id/unblock → Débloquer un comptePOST /admin/users/:id/otp-regen → Regénérer OTPPOST /admin/users/:id/suspend → SuspendreDELETE /admin/users/:id → Supprimer (RGPD)PUT /admin/users/:id/email → Changer email après vérif manuelle// TransmissionsGET /admin/transmissions → Liste avec filtresGET /admin/transmissions/:id → Détail et logsPOST /admin/transmissions/:id/extend-escrow → Étendre TTLPOST /admin/transmissions/:id/notify → Relancer les contactsDELETE /admin/transmissions/:id → Annuler// Contacts bloquésPOST /admin/transmissions/:id/contacts/:cid/unblock// QuestionsGET /admin/questions → Liste bibliothèquePOST /admin/questions → AjouterPUT /admin/questions/:id → ModifierPUT /admin/questions/:id/archive → Archiver// ConfigurationGET /admin/config → Récupérer tous les paramètresPUT /admin/config/:key → Modifier un paramètre (loggé)// MonitoringGET /admin/health → Statut de tous les servicesGET /admin/logs/audit → Logs d'actions adminGET /admin/logs/api → Logs API avec filtres// FacturationGET /admin/billing/overview → KPIs facturationGET /admin/billing/subscriptions → Liste abonnementsPOST /admin/billing/:id/extend → Étendre un abonnementPUT /admin/billing/:id/plan → Changer le plan |

| 4 — Jobs asynchrones — BullMQTâches planifiées et événementielles exécutées en arrière-plan. |

## 4.1 Queues définies
| Queue | Type | Description |
| deadman:checkin | Planifiée | Vérifie quotidiennement si des check-ins sont en retard |
| deadman:relance | Événementielle | Envoie une relance à l'utilisateur en retard |
| deadman:trigger | Événementielle | Déclenche la transmission après 3 relances sans réponse |
| escrow:cleanup | Planifiée | Supprime les escrows expirés (TTL dépassé) toutes les heures |
| storj:sync | Événementielle | Push P1 → HCV → P2 → Storj après modification vault |
| storj:cleanup | Événementielle | Supprime P2 de Storj après confirmation transmission |
| email:send | Événementielle | Envoi email avec template et retry automatique |
| session:cleanup | Planifiée | Supprime les sessions expirées de Redis toutes les 24h |
| wrapped:generate | Planifiée | Lance la génération des Wrapped annuels chaque 1er janvier |

## 4.2 Flow du dead man's switch — détail job
| // JOB : deadman:checkin (quotidien à 09:00 UTC)1. SELECT users WHERE transmission_active = true AND next_checkin_due < NOW() AND pause_mode = false2. Pour chaque user en retard : → Si relances_count = 0 : enqueue deadman:relance (relance 1) → Si relances_count = 1 et last_relance > 7j : enqueue deadman:relance (relance 2) → Si relances_count = 2 et last_relance > 14j : enqueue deadman:relance (relance 3) → Si relances_count = 3 et last_relance > 21j : enqueue deadman:trigger// JOB : deadman:relance1. Charger template email (selon langue user)2. Enqueue email:send avec lien de check-in3. Incrémenter relances_count4. Mettre à jour last_relance_at// JOB : deadman:trigger1. Marquer transmission status = 'triggered'2. Générer token unique par contact (UUID v4, TTL = 72h)3. Enqueue email:send pour chaque contact → Email contient : message personnel + lien /relay/:token4. Logger l'événement en audit log// Annulation si l'user répond entre temps→ POST /checkin/complete invalide tous les jobs en attente→ relances_count remis à 0, next_checkin_due recalculé |

## 4.3 Retry policy
| Queue | Max tentatives | Backoff | Action si échec total |
| email:send | 5 | Exponentiel (1min, 2min, 4min, 8min, 16min) | Alert admin + log |
| storj:sync | 3 | Linéaire (30s) | Marquer sync_failed, notifier user |
| storj:cleanup | 3 | Linéaire (1min) | Log + alerte monitoring |
| deadman:trigger | 3 | Linéaire (5min) | Alert admin critique |
| escrow:cleanup | 2 | Linéaire (5min) | Log |

| 5 — Intégrations externesHCV Transit, Storj, email. |

## 5.1 HashiCorp Vault Transit
| // Service : src/services/crypto/hcv.ts// Variables d'environnement requisesHCV_ADDR=https://vault.example.comHCV_TOKEN=hvs.XXXXX // Token avec politique transit uniquementHCV_KEY_NAME=relais-payload// Opérations exposéesasync encrypt(plaintext: Buffer): Promise<string> → POST /v1/transit/encrypt/relais-payload → Retourne ciphertext base64async decrypt(ciphertext: string): Promise<Buffer> → POST /v1/transit/decrypt/relais-payload → Retourne plaintext Buffer// Gestion des erreurs HCV→ 503 HCV : throw HCVUnavailableError → alert monitoring critique→ 403 HCV : throw HCVPermissionError → log + alert→ Timeout 5s : retry 1 fois puis throw// Circuit breaker→ Si 3 erreurs consécutives sur 1 minute : Passer en mode 'HCV dégradé' Rejeter toutes les opérations de chiffrement Alert monitoring critique immédiate |

## 5.2 Storj
| // Service : src/services/storj/client.ts// SDK : @aws-sdk/client-s3 (Storj est S3-compatible)// Variables d'environnementSTORJ_ENDPOINT=https://gateway.storjshare.ioSTORJ_ACCESS_KEY=XXXXXSTORJ_SECRET_KEY=XXXXXSTORJ_BUCKET=relais-payloads// Structure des clés objetpayloads/{user_id}/v1_accounts.enc // P2_1payloads/{user_id}/v1_messages.enc // P2_2payloads/{user_id}/v1_finances.enc // P2_3// Opérations exposéesasync upload(userId, category, data: Buffer): Promise<void>async download(userId, category): Promise<Buffer>async delete(userId, category): Promise<void>async deleteAll(userId): Promise<void> // post-transmission cleanup// Gestion des erreurs→ NetworkError : retry 3 fois avec backoff exponentiel→ NotFound : retourner null (vault non encore synced)→ Toutes les erreurs sont loggées avec userId anonymisé |

## 5.3 Email
| // Service : src/services/email/sender.ts// Provider V1 : Resend (simple, fiable, 3000 emails/mois gratuits)// Variables d'environnementRESEND_API_KEY=re_XXXXXEMAIL_FROM=Relais <noreply@relais.app>EMAIL_REPLY_TO=support@relais.app// Templates disponiblesemail_otp // OTP de vérificationemail_relance_1/2/3 // Relances check-in (ton progressivement plus urgent)email_transmission // Notification aux trusted contactsemail_account_events // Déblocage, changement email, suspensionemail_subscription // Renouvellement, expiration, grâce// Chaque template existe en FR et EN// La langue est déterminée par user.language// Sécurité email→ Jamais de données sensibles dans le corps d'un email→ Liens tokenisés à usage unique pour /relay/:token→ Tokens d'email expirés après 72h maximum |

| 6 — Gestion des erreursCodes d'erreur standardisés et format des réponses. |

## 6.1 Format de réponse standard
| // Succès{ success: true, data: { ... }}// Erreur{ success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', // Code machine message: 'Email ou mot de passe incorrect.', // Message humain details: { ... } // Optionnel — infos supplémentaires }} |

## 6.2 Codes d'erreur par domaine
| Code | HTTP | Description |
| AUTH_INVALID_CREDENTIALS | 401 | Email ou mot de passe incorrect |
| AUTH_ACCOUNT_LOCKED | 423 | Compte verrouillé — trop de tentatives |
| AUTH_TOKEN_EXPIRED | 401 | Token expiré — refresh requis |
| AUTH_TOKEN_INVALID | 401 | Token invalide ou malformé |
| AUTH_2FA_REQUIRED | 403 | 2FA requis pour cette action |
| AUTH_PIN_REQUIRED | 403 | PIN requis pour cette action |
| AUTH_PIN_INVALID | 401 | PIN incorrect |
| AUTH_EMAIL_NOT_VERIFIED | 403 | Email non vérifié |
| VAULT_SYNC_FAILED | 503 | Échec de synchronisation avec Storj |
| HCV_UNAVAILABLE | 503 | Service de chiffrement indisponible |
| TRANSMISSION_NOT_CONFIGURED | 409 | Transmission non configurée |
| TRANSMISSION_ALREADY_ACTIVE | 409 | Transmission déjà active |
| RELAY_TOKEN_INVALID | 404 | Token de relay invalide ou expiré |
| RELAY_TOKEN_EXHAUSTED | 429 | Trop de tentatives sur ce token |
| RELAY_CONTACT_BLOCKED | 423 | Contact bloqué — trop d'échecs |
| PLAN_LIMIT_REACHED | 403 | Limite du plan atteint (comptes ou contacts) |
| NOT_FOUND | 404 | Ressource introuvable |
| VALIDATION_ERROR | 400 | Données invalides — détails dans error.details |
| RATE_LIMITED | 429 | Trop de requêtes |
| INTERNAL_ERROR | 500 | Erreur interne — loggée et alertée |

| 7 — Rate limiting & SécuritéProtections par endpoint, par user, et par IP. |

## 7.1 Rate limits par endpoint
| Endpoint / Groupe | Limite | Fenêtre | Par |
| POST /auth/login | 10 req | 15 min | IP |
| POST /auth/register | 5 req | 1h | IP |
| POST /auth/email/verify | 10 req | 1h | User |
| POST /auth/email/resend-otp | 5 req | 1h | Email |
| POST /auth/2fa/verify | 10 req | 15 min | IP |
| POST /relay/:token/verify | 5 req (max tentatives) | Lifetime du token | Token |
| POST /relay/:token/* | 3 req/min | 1 min | IP |
| GET + PUT /vault/* | 60 req | 1 min | User |
| POST /vault/sync | 10 req | 1h | User |
| POST /checkin/game/answer | 10 req | 1h | User |
| POST /admin/auth/login | 5 req | 15 min | IP |
| GET /admin/* | 120 req | 1 min | Admin user |
| API globale | 200 req | 1 min | User |

## 7.2 Sécurité des en-têtes HTTP
| // Headers Fastify (helmet plugin)Content-Security-Policy: default-src 'self'X-Content-Type-Options: nosniffX-Frame-Options: DENYStrict-Transport-Security: max-age=31536000; includeSubDomainsX-XSS-Protection: 1; mode=blockReferrer-Policy: strict-origin-when-cross-origin// CORSOrigin: https://app.relais.cm (prod) | http://localhost:3000 (dev)Credentials: true (pour les cookies HttpOnly)// CookiesHttpOnly: trueSecure: true (prod uniquement)SameSite: StrictPath: /auth/refresh |

## 7.3 Validation des entrées
| // Toutes les routes utilisent JSON Schema via Fastify// Validation automatique avant d'atteindre le handler// Exemple : POST /auth/login{ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', maxLength: 255 }, password: { type: 'string', minLength: 10, maxLength: 128 } }, additionalProperties: false // IMPORTANT : rejeter les champs inconnus}// Règle générale : additionalProperties: false sur TOUS les schémas// Prévient les injections par champs inattendus |

| 8 — Variables d'environnementConfiguration complète par environnement. |

| # Base de donnéesDATABASE_URL=postgresql://user:pass@host:5432/relaisREDIS_URL=redis://host:6379# AuthentificationJWT_ACCESS_SECRET=<256 bits random>JWT_REFRESH_SECRET=<256 bits random>JWT_ACCESS_EXPIRY=15mJWT_REFRESH_EXPIRY=90dJWT_STEPUP_SECRET=<256 bits random>JWT_STEPUP_EXPIRY=5m# HashiCorp VaultHCV_ADDR=https://vault.example.comHCV_TOKEN=hvs.XXXXXHCV_KEY_NAME=relais-payloadHCV_TIMEOUT_MS=5000# StorjSTORJ_ENDPOINT=https://gateway.storjshare.ioSTORJ_ACCESS_KEY=XXXXXSTORJ_SECRET_KEY=XXXXXSTORJ_BUCKET=relais-payloads# EmailRESEND_API_KEY=re_XXXXXEMAIL_FROM=Relais <noreply@relais.app>EMAIL_REPLY_TO=support@relais.app# AppNODE_ENV=productionPORT=3000APP_URL=https://api.relais.cmFRONTEND_URL=https://app.relais.cm# MonitoringSENTRY_DSN=https://xxx@sentry.io/xxxLOG_LEVEL=info |

| 9 — Monitoring & ObservabilitéLogs, métriques, alertes. |

## 9.1 Logs structurés
| // Format JSON avec Pino (intégré à Fastify){ timestamp: '2026-04-30T14:23:00Z', level: 'info', requestId: 'req_xxx', userId: 'hash_anonyme', // Jamais le vrai UUID en logs publics method: 'POST', path: '/checkin/complete', statusCode: 200, duration: 42, // ms ip: 'hash_ip' // Hashé pour conformité RGPD}// Jamais dans les logs :→ Mots de passe, tokens, clés→ Contenu chiffré (blobs)→ Questions secrètes ou réponses→ Messages personnels |

## 9.2 Health check endpoint
| GET /health→ Vérifie : PostgreSQL, Redis, HCV, Storj, email→ Retourne : { status, services: { [name]: 'ok'|'degraded'|'down' }, uptime }→ Utilisé par le monitoring et le back office→ Pas d'authentification requise→ Rate limité : 60 req/min par IP |

## 9.3 Alertes critiques
| Condition | Sévérité | Canal |
| HCV indisponible > 2min | Critique | PagerDuty + email admin |
| deadman:trigger job échoue 3 fois | Critique | PagerDuty + email admin |
| Taux d'erreur 5xx > 5% sur 5min | Haute | Email admin |
| Storj indisponible > 5min | Haute | Email admin |
| Queue BullMQ stalled > 10 jobs | Haute | Email admin |
| Escrow expire sans completion | Haute | Email admin |
| Taux d'erreur 4xx > 20% sur 5min | Moyenne | Log + dashboard |
| Latence P95 > 2s sur 5min | Moyenne | Log + dashboard |

— Fin des Backend Specs v1.0 —
Prochaine étape : Schéma PostgreSQL
