# RELAIS — Backend : notes d'implémentation

**Specs de référence** (révision de septembre 2026) : Backend Specs v1.1
réécrite, Specs Techniques v1.2, Journal des Décisions DEC-01 à DEC-35,
Schéma PostgreSQL v1.4, Frontend Specs v1.1. Les écarts de contrat entre
cette révision et l'API livrée sont listés dans `docs/open-questions.md` §B.

Ce document ne redécrit pas l'API — il consigne ce qui a été décidé en la
construisant, les écarts par rapport aux specs, et ce qui a été vérifié.

## 1. Où sont les choses

```
apps/api/
  src/
    app.ts                   buildApp() — plugins, hooks, routes
    index.ts                 bootstrap, arrêt propre
    config/env.ts            variables d'environnement validées (zod)
    lib/                     prisma, redis, erreurs/enveloppe, crypto, jwt
    plugins/                 enveloppe d'erreur, helmet/cors/cookie, rate limit
    middleware/              authenticate, requireStepUp
    services/email/          transports console/Resend, templates FR/EN, email_log
    services/storage/        stockage objet : memory / fs / S3 (Storj)
    services/secrets/        relais_x25519_sk — seul secret cryptographique serveur (DEC-30)
    lib/sodium.ts            libsodium-wrappers chargé en CommonJS (son entrée ESM est cassée)
    api/health/              GET /health
    api/auth/                schemas, service, routes
    api/vault/               sync, sync-status, restore
    api/transmission/        contacts, schéma, activation, pause, vérification annuelle
    api/checkin/             statut, mini-jeu (games.ts), validation, streak
    api/relay/               côté contact : lien, réponses/escrow, données, confirmation
    api/journal/             carnet de vie : question du mois, entrées signées, Wrapped
    api/admin/               back office : auth TOTP, dashboard, utilisateurs, transmissions, questions, config, audit, facturation, tickets
    api/support/             tickets support côté utilisateur, ouverts sans compte
    jobs/billing.ts          cycle de vie des abonnements : grâce puis rétrogradation
    middleware/authenticate-admin.ts  token admin + session Redis, grille de rôles
    lib/audit.ts             journal d'audit append-only (jamais de donnée personnelle)
    scripts/create-admin.ts  bootstrap du premier admin (npm run admin:create)
    jobs/relay-cleanup.ts    escrows expirés, fin d'accès à 30 jours
    jobs/deadman.ts          balayage quotidien : relances, déclenchement
    jobs/queue.ts            BullMQ — jobs planifiés deadman:checkin, relay:cleanup
  test/                      Vitest + Supertest sur PostgreSQL et Redis réels
scripts/dev-services.sh      PostgreSQL 16 + Redis jetables, migrations + seed
```

Stack telle que spécifiée (§1.1) : Node 22, Fastify 5, TypeScript strict,
Prisma 6 sur le schéma racine, ioredis, Vitest + Supertest, Pino.

## 2. Périmètre livré

Le module **auth** de §3.1 v1.1, le module **vault** de §3.3 v1.1, le module
**transmission** de §3.4 (côté owner), et `/health` :

| Endpoint | Note |
|---|---|
| `POST /auth/register` | Inscription en attente dans Redis, rien en base avant l'OTP |
| `POST /auth/email/verify` | Crée user + subscription, ouvre une session |
| `POST /auth/email/resend-otp` | Invalide l'ancien code, 5/h/email |
| `POST /auth/login` | Verrou 15 min après 5 échecs, email de notification |
| `POST /auth/refresh` | Rotation du refresh token |
| `POST /auth/logout` | Révocation immédiate de la session |
| `GET /auth/me` | Profil public — ajout, pratique pour l'app |
| `POST /auth/pin/step-up` | DEC-25 |
| `POST /auth/seed/display` | DEC-27 — retourne `{ authorized: true }` |
| `POST /auth/keys` | **Ajout** — step-up `set_key`, écriture unique et atomique (audit LOW-13) — voir §3 |
| `PUT /auth/password` | Step-up, ancien mot de passe, révoque les autres sessions |
| `POST /auth/password/reset-request` | Réponse générique |
| `POST /auth/password/reset` | OTP + signature Ed25519 — voir §3 |
| `GET /auth/restore/challenge` | DEC-06 |
| `POST /auth/restore/verify` | DEC-06 |
| `POST /auth/2fa/setup` · `verify` · `DELETE /auth/2fa` | E6-US02 ; `verify` rend 8 codes de récupération à l'activation et en accepte un (`recovery_code`) au login — voir §3 |
| `POST /vault/sync` | Blob chiffré + `ts` + signature Ed25519 liant catégorie et horodatage (DEC-07, audit MEDIUM-7 : fenêtre ± 5 min, jamais en arrière), taille plafonnée par `vault.max_size_mb` |
| `GET /vault/sync-status` | Date et taille par catégorie, lues sur le stockage |
| `POST /vault/restore` | Renvoie le blob tel quel — exige un challenge Ed25519 vérifié dans les 15 minutes (403 `AUTH_RESTORE_REQUIRED`, audit LOW-13) |
| `GET /transmission/relais-key` | **Public**, 60/min/IP, cache 24 h — DEC-28 |
| `GET /transmission/config` | État complet, contacts inclus (jamais `removed`), `secret_enc` de chaque contact rendu à l'owner — voir §3 |
| `GET /transmission/questions` | Bibliothèque des questions secrètes (BO-04) : actives, `secret_question` ou `both`, score ≥ `vault.question_min_score`, groupées par catégorie |
| `POST /transmission/contacts` | Note-01, limite de plan, signature et sealed box vérifiées |
| `PUT /transmission/contacts/:id` | Step-up `edit_contacts`, mêmes règles |
| `DELETE /transmission/contacts/:id` | Step-up `edit_contacts`, retrait logique |
| `PUT /transmission/schema` | Step-up `edit_contacts`, N ≥ 2, M ≥ N |
| `PUT /transmission/config` | Step-up `edit_transmission`, DEC-22 |
| `POST /transmission/activate` | Step-up `activate_transmission` — DEC-29, DEC-30, Proposal-8 (`plain_hash` + `plain_sig` par part), email `contact_designated` — voir §3 |
| `POST /transmission/pause` · `DELETE /transmission/pause` | E4-US04, 7 / 30 / 90 jours, plafond `dms.pause_max_months` |
| `DELETE /transmission` | Step-up `delete_transmission`, parts purgées |
| `POST /transmission/cancel` | Step-up `cancel_transmission` : l'owner vivant annule une transmission déclenchée — escrow purgé, liens morts, config de nouveau active, contacts prévenus (12/09/2026), voir §3 |
| `GET /transmission/contacts/:id/verify-challenge` · `POST /transmission/contacts/:id/verify` | Vérification annuelle — challenge serveur (5 min, usage unique) puis attestation signée `SHA256(verify_token ‖ challenge)`, voir §3 |
| `GET /checkin/status` | Échéance, retard en jours, relances, « validé ce mois » |
| `GET /checkin/game` · `POST /checkin/game/answer` | Défi côté serveur, 10 réponses/h/user (§7.1) — voir §3 |
| `POST /checkin/complete` | Consomme le jeton du jeu ; ligne du mois, streak, badge ; replanifie l'échéance |
| `GET /checkin/history` · `GET /checkin/streak` | Log des mois validés ; streak courant, record, badges |
| `POST /auth/push-token` · `DELETE /auth/push-token` | Lot 5 mobile : identifiant d'abonnement OneSignal du device (un token, un compte), désactivé au retrait — voir §3 |
| `GET /relay/:token` | **Public** (token du lien), 30/min/IP : questions, rôles, `verify_token`, Si_enc, `secret_enc`, état |
| `POST /relay/:token/verify` | 10/min/IP (audit LOW-15) ; `{ failed: true }` ou `{ shares }` (33 octets par rôle : index Shamir + 32) ; part comparée au hash signé à l'activation (422 `RELAY_SHARE_INVALID`) ; 5 tentatives puis blocage 24 h, les autres contacts prévenus ; parts en escrow — voir §3 |
| `GET /relay/:token/status` | Répondu / requis / total, catégories déverrouillées |
| `GET /relay/:token/data` | Une fois N parts réunies : parts de l'escrow + P2 + `secret_enc`, par rôle détenu ; `journal` (carnet sous K2) pour le porteur de K2 — lot 6, voir §3 |
| `POST /relay/:token/confirm` | 3/min/IP ; termine et purge quand chaque contact ayant répondu a confirmé |
| `GET /journal/question` | Question du mois par mode (`essential`, `reflective` ; `free` → aucune), « déjà répondu » |
| `POST /journal/entries` · `GET /journal/entries` · `GET /journal/entries/:id` · `GET /journal/entries/month/:ym` | Écritures signées Ed25519 (DEC-31), une entrée par mois, liste sans contenu, lecture par mois (`YYYY-MM`, 404 si vide) |
| `PUT` · `DELETE /journal/entries/:id` | Signées ; `DELETE` signe l'identifiant — voir §3 |
| `POST` · `GET /journal/wrapped/:year` · `GET`/`POST …/export` | Seuil de 6 entrées et `entry_count` côté serveur (DEC-32) |
| `POST /admin/auth/login` · `logout` · `GET /admin/me` | TOTP obligatoire, 5/15 min/IP, token admin 8 h + session Redis |
| `GET /admin/users` · `GET /admin/users/:id` | BO-02 : liste paginée et filtrée, fiche en métadonnées |
| `POST …/unblock` · `POST /admin/users/otp-regen` · `POST …/suspend` · `PUT …/email` · `DELETE /admin/users/:id` | Support, admin, super_admin ; chaque action auditée — voir §3 |
| `GET /admin/transmissions` · `GET …/:id` | BO-03 : statuts et compteurs, aucune identité de contact |
| `POST …/extend-escrow` · `POST …/notify` · `DELETE …/:id` · `POST …/contacts/:cid/unblock` | Escrow +24/48 h (2 max), nouveaux liens, annulation, déblocage |
| `GET` · `POST /admin/questions` · `PUT …/:id` · `PUT …/:id/archive` | BO-04, rôle admin, audité |
| `GET /admin/config` · `PUT /admin/config/:key` | BO-05, super_admin, validé par type, avant/après audité ; `billing.trial_days` retirée le 12/09/2026 (sans règle ni effet) |
| `GET /admin/logs/audit` · `GET /admin/health` | BO-06 |
| `GET /admin/billing/overview` · `GET /admin/billing/subscriptions` · `GET /admin/billing/export` | BO-07, rôles finance / super_admin ; la liste porte `user_email` et `full_name` et accepte `search` (BO lot 3) ; l'export reste sans email |
| `PUT /admin/billing/:id/plan` · `POST /admin/billing/:id/extend` | Encaissement manuel, renouvellement, rétrogradation, geste commercial — voir §3 |
| `GET /admin/dashboard` | BO-01 : les huit KPIs et les alertes calculables, triées par criticité — voir §3 |
| `POST /support/tickets` · `GET /support/tickets` | Ouvert sans compte (email, 3/h/IP) ou avec token ; ses propres tickets — voir §3 |
| `GET /admin/tickets` · `GET …/:id` · `PUT …/:id` | BO-02, rôle support : file, prise en charge, résolution (email `ticket_resolved` au demandeur, 12/09/2026), `TICKET_UPDATE` audité |
| `GET /admin/admins` | Id, nom, rôle, statut des admins — jamais d'email ; pour assigner un ticket à un collègue (12/09/2026) |

Jobs (§4), BullMQ, worker dans le processus API derrière `JOBS_ENABLED=true` :

| Job | Quand | Fait |
|---|---|---|
| `deadman:checkin` | 09:00 UTC | Relances J+7/14/21, passage `triggered`, puis ouverture des transmissions : ligne `transmissions`, un token de relay par contact, emails ; lot 5 : push le jour de l'échéance, avec la relance 1, et à J-3 de la fin d'une pause (+ email `pause_ending`), reprise d'une pause échue — voir §3 |
| `relay:cleanup` | toutes les heures (h+30) | Escrows expirés → `expired` + nouveaux liens, jusqu'à `dms.relay_max_restarts` (3) expirations puis arrêt et alerte dashboard ; accès déverrouillé depuis plus de 30 jours → purge |
| `maintenance:purge` | horaire (:15) | OTP, challenges de restauration et sessions expirés (audit MEDIUM-9) |
| `billing:expire` | 09:45 UTC | Échéance dépassée → grâce (premium conservé, email) ; grâce écoulée → expiré, plan gratuit, email |

Non livré : `/user/*`, `PUT /transmission/recipients` (sans objet depuis
DEC-23), `GET /admin/logs/api` (tranché : export des logs Pino vers un outil
externe, pas de table — `docs/open-questions.md` §D.5), un fournisseur de
paiement (voir §3),
`storj:cleanup` (la purge est faite directement, voir §3), l'enregistrement
Arbitrum (voir §3).

## 3. Décisions et écarts par rapport aux specs

### L'inscription attend dans Redis, pas en base

E1-US01 dit « le compte n'est créé qu'après validation de l'OTP ». Le schéma
le permet — `email_otp.user_id` est nullable « si user non encore créé ».
Les données saisies (nom, téléphone, hash du mot de passe, langue) vivent
30 minutes dans Redis, l'OTP 10 minutes en base avec `user_id NULL`.

Conséquence appréciable : **pas de squat d'adresse**. Créer un `users` en
`pending_verification` dès l'inscription aurait permis à n'importe qui de
bloquer l'email d'autrui sans jamais le prouver.

### `POST /auth/keys` — un endpoint que la spec n'a pas

DEC-05 : « `ed25519_pk` stockée en PostgreSQL à l'inscription ». Le schéma :
« NULL jusqu'à la complétion onboarding ». Mais dans le parcours E1, le seed
est généré **après** l'OTP (E1-US02 vient après E1-US01) — l'app n'a pas
encore de clé à envoyer au moment du `register`.

Il faut donc un endpoint pour la déposer une fois l'onboarding fini. Sans
lui, ni la restauration (DEC-06) ni la signature des syncs (DEC-07) ne
peuvent fonctionner. Enregistrement unique : `AUTH_KEY_ALREADY_SET` ensuite
(même seed = même clé, il n'y a rien à changer).

Audit LOW-13 : l'endpoint exige un step-up `set_key` — le PIN vient d'être
posé, l'app l'obtient sans rien demander — et n'écrit que si la clé est
encore nulle, en une seule requête (`updateMany … WHERE ed25519_pk IS
NULL`) : un access token volé pendant l'onboarding ne fixe plus la clé, et
deux enregistrements parallèles ne gagnent pas tous les deux.

### `sid` dans l'access token, et révocation immédiate

Le cookie refresh est limité à `Path=/auth/refresh` (§7.2) — `/auth/logout`
ne le reçoit donc jamais. L'access token porte l'id de session (`sid`) pour
que logout sache quoi révoquer.

Ce claim rend possible autre chose : `authenticate` vérifie que la session
existe encore. Un token révoqué — logout, changement ou réinitialisation de
mot de passe, action admin — est refusé **tout de suite**, pas 15 minutes
plus tard à son expiration. E6-US03 (« toutes les sessions actives sur
d'autres devices sont invalidées ») le demande ; un JWT purement stateless ne
le tient qu'au prochain refresh. Coût : une lecture par clé primaire, qui
remplace celle du statut utilisateur — même nombre de requêtes qu'avant.

C'est le seul écart avec « stateless » (§1.2), et il est délibéré. Le test
qui l'a révélé : après un reset de mot de passe, l'ancien access token
répondait encore 200.

### Réinitialisation : OTP + signature, sans troisième endpoint

E1-US05 : « réinitialisation via email + 12 mots ». L'OTP prouve l'email ; la
preuve du seed est une signature Ed25519. Plutôt qu'un aller-retour
challenge supplémentaire, le message signé est déterministe et lié à l'OTP :

```
message = "relais:password-reset:v1:" + email + ":" + code
```

L'OTP étant à usage unique, le message ne peut pas être rejoué. La signature
est vérifiée **avant** de consommer l'OTP : quelqu'un qui contrôle la boîte
mail mais pas le seed ne peut pas brûler le code du propriétaire.

Si le compte n'a pas encore de clé (onboarding inachevé), l'OTP seul suffit —
il n'y a pas de coffre à protéger.

### HMAC plutôt que SHA256 pour l'OTP

Le schéma prévoit `otp_hash = SHA256(otp_code)`. Un OTP à 6 chiffres n'a
qu'un million de valeurs : un SHA256 sans secret se casse hors ligne en
quelques millisecondes si la table fuit. `HMAC-SHA256(code, TOKEN_HMAC_SECRET)`
garde le format attendu (64 hex, le CHECK passe) et ferme cette porte. Même
traitement pour les refresh tokens, là où la spec le prévoyait déjà.

### Compteurs d'échec de connexion : en base, pas en Redis

Backend Specs §2.5 dit « compteur en Redis ». Le schéma v1.1 a ajouté
`users.login_fail_count` et `login_locked_until`. Le schéma est plus récent et
le back office (BO-02, cas 1) doit lire ces valeurs — donc en base.

### Types d'email manquants dans `email_log`

Le CHECK v1.3 n'a aucun type pour cinq notifications que les user stories
exigent : compte verrouillé (§2.5), mot de passe changé (E6-US03), coffre
restauré (E6-US01), 2FA activée / désactivée (E6-US02). Sans eux, il aurait
fallu soit ne pas envoyer ces emails, soit les envoyer sans les tracer
(DEC-24). Ajoutés par la migration `20260425000000` ; le Schéma v1.4
(Point-1) reprend les cinq types à l'identique.

### Vault : la signature porte sur le blob envoyé

DEC-07 écrit `hash = SHA256(P1)` puis `payload: base64(P1)` — d'avant DEC-16,
quand HCV produisait P2 côté serveur. Backend Specs v1.1 §3.3 envoie
`payload: base64(P2)` mais garde `signature: sign(SHA256(P1))` : le serveur
n'a pas P1 et ne pourrait rien vérifier.

La seule lecture cohérente : **la signature porte sur le SHA256 des octets
reçus**. C'est ce qui est implémenté, et c'est ce que DEC-07 veut dire — que
seul le détenteur de `ed25519_sk` puisse modifier le backup, même avec un
access token volé. L'app signe le hash de ce qu'elle envoie ; le serveur
recalcule et vérifie. Un blob altéré en route est refusé (testé).

### Vault : aucune table, l'état vit dans le stockage

DEC-21 : pas de table vault. `GET /vault/sync-status` ne lit donc rien en
PostgreSQL — il fait un HEAD sur les trois clés et renvoie date et taille.
`transmission_configs.storj_vault_path` est le seul pointeur, posé au premier
sync (la ligne est créée `inactive` si elle n'existe pas encore).

Le serveur sait qu'un utilisateur a un backup de telle taille à telle date,
et rien d'autre : pas le nombre de comptes, pas les catégories réellement
remplies (un blob peut être vide côté contenu), pas la fréquence des
modifications au-delà du dernier upload.

### Vault : sync synchrone, pas de job `storj:sync`

Backend Specs §4.1 prévoit un job BullMQ `storj:sync` — « push P1 → HCV →
P2 → Storj ». HCV a disparu (DEC-16) ; l'upload est un simple `put` et
l'app a besoin de savoir tout de suite s'il a réussi. Il se fait donc dans
la requête. Le job n'a plus de raison d'être.

### Stockage : trois backends derrière une interface

`ObjectStore` — `put` / `get` / `head` / `delete` / `deletePrefix` / `ping`.
`memory` pour les tests, `fs` pour le dev local, `s3` pour Storj en
production (§5.2, `@aws-sdk/client-s3`, `forcePathStyle`). Les clés sont
validées contre un motif strict : pas de `..`, pas de `/` initial, jamais
un segment vide — le layout `payloads/{user_id}/v1_{category}.enc` est
imposé par le service vault, pas par l'appelant.

`/health` rapporte `storj: unconfigured` tant que le backend n'est pas `s3`,
plutôt que `ok` pour un dossier local.

### Transmission : `GET /relais-key` est public, la clé privée vit dans `secrets`

DEC-28 : l'app scelle `{ email, phone }` avec `crypto_box_seal` vers la clé
X25519 de Relais. L'endpoint est public (l'app en a besoin avant tout
compte), limité à 60/min/IP, servi avec `Cache-Control: public,
max-age=86400`, et renvoie `key_version` (16 hex de SHA256 de la clé
publique) pour que l'app sache avec quelle clé chaque boîte a été scellée
si la clé tourne un jour.

DEC-30 / Backend v1.1 §9.1 : la clé privée est lue **uniquement** par
`services/secrets` (`getRelaisX25519Sk()`). En production elle vient de
HashiCorp Vault, KV v2 (`HCV_ADDR`, `HCV_TOKEN`, chemin
`secret/data/relais/x25519_sk`, champ `x25519_sk`) — la configuration
refuse de démarrer sans, et refuse `RELAIS_X25519_SK_DEV` ; en dev et test
elle vient de `RELAIS_X25519_SK_DEV` (hex 64 ou base64 44). Une lecture HCV
ratée se retente à l'appel suivant, jamais de repli sur une clé de dev.
`/health` sonde `sys/health` dès que HCV est configuré, ce qui alimente
l'alerte « HCV indisponible » de BO-01 via `service_down`.

### Transmission : la sealed box est ouverte à la création, pas seulement à l'activation

Un contact dont la boîte ne s'ouvre pas avec la clé de Relais, ou ne
contient pas d'email, est inutile le jour venu. `POST /contacts` l'ouvre
donc et vérifie la forme (`{ email, phone }`, email valide) avant
d'accepter — puis jette le clair. Il n'est ni stocké ni loggé ; il n'est
relu qu'à l'activation, le temps d'envoyer l'email (DEC-30).

### Transmission : le serveur choisit le chemin des parts et calcule le hash

Le corps de `POST /activate` spécifié envoie `storj_kN_path` et
`share_kN_hash` choisis par le client. Ici le client envoie les octets :
`shares.kN = { enc, sig }` (`enc` = Si_enc, `sig` = Ed25519 sur
SHA256(Si_enc), DEC-29). Le serveur :

- vérifie **toutes** les signatures avant la moindre écriture — une seule
  invalide rejette l'activation (401), rien n'est persisté ;
- exige une part par rôle détenu, aucune pour les autres ;
- dépose chaque part à `shares/{user_id}/{contact_id}/kN.enc` et calcule
  `share_kN_hash` lui-même. Un chemin choisi par le client ne pourrait ni
  être vérifié, ni être protégé contre l'écrasement d'un autre objet.

Les noms de champs suivent ceux de `POST /contacts` (`roles`, `question_ids`,
`schema: { n, m }`) plutôt que `has_kN_role` / `question_N_id` / `schema_n`.

Le corps doit reprendre **chaque contact vivant, une fois** (re-signé,
revalidé — l'activation est la version définitive), sinon 400 avec les
identifiants manquants ou inconnus. Préconditions, en 409
`TRANSMISSION_NOT_CONFIGURED` : au moins deux contacts, M ≤ nombre de
contacts, au moins un détenteur du rôle K1.

L'activation vaut premier check-in : `last_checkin_at = maintenant`,
`next_checkin_due = maintenant + checkin_frequency_weeks`.

### Transmission : pas d'Arbitrum

L'étape 5 de l'activation (`contract.register()`) n'est pas implémentée :
pas de service blockchain dans ce lot, `contract_registered` reste `false`.
Les hashes sont en base et prêts à être poussés. Consigné dans
`docs/open-questions.md`. Le contrat v2 existe depuis le 12/09/2026
(`contracts/`, `docs/smart-contract-v2.md` §9) ; son branchement dans l'API
est le lot 2 (§3 du design).

### Transmission : l'email de désignation porte le prénom que l'owner met dans la sealed box

DEC-30 envoie un email à chaque contact dès l'activation ; le Schéma v1.4
(Point-1) lui donne son type, `contact_designated` (« rien à faire pour
l'instant »). Le serveur ne connaît pas le nom de l'owner : la sealed box
peut contenir `owner_display_name` en plus de `email` et `phone` — même
niveau de confidentialité que l'email du contact (DEC-12, niveau 1),
tronqué à 60 caractères, jamais stocké en clair. Sans lui, l'email dit
« une personne qui vous fait confiance ».

### Transmission : `secret_enc` est rendu à l'owner, et porte email et téléphone

Lot 4 mobile (12/09/2026). Nom, email, téléphone et message d'un contact ne
sont lisibles que sur le device de l'owner : la sealed box est scellée vers
Relais, pas vers lui. Pour qu'un nouveau device retrouve ses contacts avec
les 12 mots, `secret_enc` (déjà sous K2, déjà remis au contact au relay)
porte aussi `email` et `phone`, et `GET /transmission/config` le renvoie
tel quel. Le serveur n'y lit toujours rien. Les réponses secrètes, elles,
ne quittent jamais le device (voir `docs/mobile.md` §3).

### Transmission : contacts et schéma figés une fois active

Les parts Shamir dépendent des contacts, de leurs rôles, de leurs questions
et du schéma. Après activation, `POST/PUT/DELETE /contacts` et
`PUT /schema` répondent 409 `TRANSMISSION_ALREADY_ACTIVE`. Le parcours de
modification est : `DELETE /transmission` (parts purgées, contacts
conservés) → modifier → `POST /activate` avec de nouvelles parts signées.
`PUT /config` (silence, fréquence) reste possible à tout moment.

### Transmission : vérification annuelle = attestation signée

§7.2 : l'owner ressaisit ses réponses, l'app dérive K_i et ouvre
`verify_token` localement. Le serveur ne voit ni réponses ni K_i ; il ne
peut que dater l'attestation. `GET /config` expose `verify_token` à l'owner ;
l'app demande `GET /contacts/:id/verify-challenge` (nonce de 32 octets,
Redis `tx:verify`, 5 minutes, consommé à la première tentative) et
`POST /contacts/:id/verify` exige `{ challenge_id, signature }` avec
`Ed25519.sign(SHA256(verify_token ‖ challenge))` de la clé de l'owner — même
preuve de possession que le vault (DEC-07). Sans cela, n'importe quel
porteur d'access token pourrait « vérifier » ; sans le challenge (audit
LOW-15), une attestation capturée se rejouait indéfiniment.

### Transmission : pause = `edit_transmission`

DEC-25 ne liste pas d'action pour la pause ; E4-US04 exige le PIN.
`POST /pause` utilise `edit_transmission`. La reprise (`DELETE /pause`) ne
demande pas de PIN — elle ne fait que réarmer le check-in.

### Check-in : le jeu vit côté serveur, la preuve de vie aussi

E4-US01 demande un mini-jeu « fun, < 60 s, jamais un quiz sur le coffre »,
sans dire qui le fournit. Si le client validait seul, un script pourrait
« checker » sans personne derrière — le dead man's switch perdrait son sens.
Le serveur tire donc un défi dans une bibliothèque intégrée
(`api/checkin/games.ts` : énigmes FR/EN, suites logiques, tri), garde la
référence 24 h dans Redis, compte les tentatives (sans pénalité, E4-US01),
normalise la réponse (casse, accents, ponctuation) et rend un
`checkin_token` à usage unique (15 min) que `POST /complete` consomme. Le
critère « validé par simple ouverture de l'app » n'est pas retenu côté API :
une ouverture ne prouve rien au serveur.

### Check-in : un mois calendaire, un streak, quatre badges

`checkin_log` est unique par (user, mois). Le premier check-in du mois crée
la ligne (`game_type`, `attempts`, `streak_at_checkin`, `badge_earned`) ; les
suivants du même mois ne font que replanifier `next_checkin_due` et remettre
les relances à zéro. Le streak compte les mois calendaires consécutifs ; les
badges sont `first_checkin`, `streak_3`, `streak_6`, `streak_12`.
`GET /checkin/streak` considère le streak vivant si le dernier mois validé
est le mois courant ou le précédent. Une fréquence hebdomadaire produit donc
plusieurs check-ins par mois et une seule ligne — voulu.

`journal_entry_id` est accepté et vérifié (entrée de l'utilisateur), pour
que le carnet de vie puisse rattacher la réponse du mois (E2-US07) ; le
module journal remplira le reste.

### Push : OneSignal, alias haché, fenêtres du jour, aucune trace

Lot 5 mobile (12/09/2026, `docs/mobile.md` §3). `services/push` cible
l'utilisateur par `external_id = SHA256(user_id)` ; la charge ne contient
qu'un titre, une phrase et la route à ouvrir, identiques pour tous. L'envoi
n'a lieu que si le compte a un abonnement actif dans `push_tokens`
(`POST /auth/push-token` : un identifiant d'abonnement appartient au dernier
compte qui l'a présenté ; `DELETE` le désactive). Transport `console` en
dev et test, `onesignal` en production (`PUSH_TRANSPORT`, `ONESIGNAL_APP_ID`,
`ONESIGNAL_REST_API_KEY`, DEC-18) ; un push qui ne part pas ne casse pas le
job. Rien n'est tracé en base : le job quotidien décide par la fenêtre du
jour (retard de 0 jour, relance 1, 3 jours restants de pause), donc chaque
push part une fois — un second run manuel le même jour le renverrait.

### Pause : rappel à J-3 et reprise automatique

E4-US04 demande un rappel trois jours avant la fin ; rien ne disait qui
reprend les check-ins. Le balayage envoie l'email `pause_ending` (nouveau
type, migration `20260912000000`) et le push quand il reste exactement
trois jours, puis, une fois `pause_until` passé, remet la config `active`
avec un check-in à + fréquence et les relances à zéro — la même chose que
`DELETE /pause`. E6-US04 « ne peut pas être renouvelé automatiquement »
reste vrai : la pause se termine, elle ne se prolonge pas.

### Dead man's switch : relances à J+7/14/21, déclenchement après le silence

Le pseudo-code du job §4.2 déclenche à « relance 3 + 21 jours », ce qui
rendrait `silence_duration_months` (1, 3, 6 — choisi par l'utilisateur,
E4-US03) sans effet. Ici :

- relance N quand l'échéance est dépassée de `dms.relance_intervals_days[N-1]`
  jours (7, 14, 21), au plus une par balayage, tracée dans
  `checkin_relances` (FK `email_log_id`, Fix-12c) ;
- déclenchement quand les trois relances sont parties **et** que l'échéance
  est dépassée de `silence_duration_months × 30` jours : la config passe
  `triggered`. Les tokens des contacts, la ligne `transmissions` et les
  emails `/relay` sont le travail du module relay, qui reprendra les configs
  `triggered` sans ligne `transmissions`.

`sweep(now)` reçoit son horloge : les tests le pilotent jour par jour sans
attendre ni mocker. BullMQ ne fait que l'appeler.

### Relay : les réponses ne quittent pas l'app, les parts si

E5-US02 : « le process est entièrement local — les réponses ne transitent
pas sur le réseau ». Le serveur ne reçoit donc jamais les réponses ni K_i.
`GET /relay/:token` donne à l'app tout ce qu'il faut pour travailler seule
(questions, `verify_token`, ses Si_enc) ; l'app dérive K_i, vérifie ses
réponses avec `verify_token`, déchiffre ses parts, et dépose **les parts
Si** (`POST /verify { shares }`), 33 bytes par rôle détenu (index Shamir + 32). Elles vont en
`escrow_shares`, scellées (secretbox) par une clé éphémère Redis
(`escrow:key:{transmission}`) qui expire avec l'escrow — c'est l'escrow de
Techniques §6.7, ni plus ni moins : le serveur détient les parts le temps
que N contacts répondent, et ne les combine jamais. `GET /data` rend les N
parts et P2 au contact déverrouillé ; Shamir et le déchiffrement final se
font sur son device (§6.8).

**Proposal-8** (adoptée) : pour qu'une part fausse se voie ici et non au
déchiffrement final, l'activation reçoit pour chaque part `plain_hash =
SHA256(Si)` et `plain_sig = Ed25519.sign(plain_hash)` — même primitive que
DEC-29 — stockés dans `trusted_contacts.share_kN_plain_hash`. Au dépôt, le
serveur compare ; une part qui ne correspond pas répond 422
`RELAY_SHARE_INVALID` et compte comme un échec. 32 bytes par part, aucune
information sur Si (32 bytes d'entropie).

### Relay : « 5 tentatives puis blocage 24 h », tenu par le serveur sur déclaration de l'app

Puisque les réponses ne passent pas par le serveur, il ne voit pas les
échecs — sauf si l'app les déclare : `POST /verify { failed: true }`. Chaque
échec déclaré et chaque envoi malformé incrémentent `fail_count` ; au
cinquième, 429 `RELAY_TOKEN_EXHAUSTED`, contact bloqué (`blocked` +
`trusted_contacts.blocked_until` = 24 h, `security.contact_lock_hrs`), le
lien répond 423 puis se rouvre seul, compteur à zéro. Le vrai frein contre
la force brute reste Argon2id sur le device ; le serveur tient le compteur
que la spec lui demande. Proposal-9 : au blocage (E5-US02) comme à une
confirmation qui ne termine pas la transmission (E5-US03), les autres
contacts non bloqués reçoivent un `contact_progress` — l'événement
seulement, rien de personnel.

### Relay : le carnet part avec K2 et disparaît à la purge

Lot 6 mobile (12/09/2026). E2-US07 veut la capsule « incluse dans la
transmission au Gardien du souvenir » : `GET /relay/:token/data` rend
`journal` (mois, mode, `content_enc`) au contact qui porte K2, une fois la
catégorie déverrouillée — un blob par mois, opaque pour le serveur, lisible
par le contact avec la K2 qu'il a reconstituée. E5-US05 « toutes les
données chiffrées sont supprimées » : la purge finale supprime aussi
`journal_entries` et `annual_wrappeds` (les check-ins du mois sont détachés
d'abord).

### Audit de sécurité (12/09/2026) : les trois constats HIGH corrigés

L'audit interne de `apps/api` (rapport dans l'historique de la tâche 50)
relevait quinze constats ; les trois graves sont corrigés ici, test-first,
les autres suivent dans des PR dédiées.

- **Purge par un seul contact** : `POST /relay/:token/confirm` n'exigeait que
  le statut `answered` ; le premier contact à répondre pouvait donc « terminer »
  et purger coffre et parts avant tout déverrouillage, même si l'owner était
  vivant. Désormais la confirmation est refusée (`RELAY_NOT_UNLOCKED`) tant
  qu'aucune catégorie d'un rôle détenu par ce contact n'est déverrouillée —
  la même règle que `GET /data`.
- **Annulation admin** : `trigger()` cherchait une config `triggered` « sans
  ligne `transmissions` » ; après `POST /admin/transmissions/:id/cancel` la
  ligne `cancelled` restait, et la config ne rouvrait plus jamais de
  transmission au silence suivant, sans erreur. Seules `triggered` et
  `in_progress` comptent maintenant comme ouvertes.
- **Limites de débit contournables et force brute TOTP** : `trustProxy: true`
  faisait de `X-Forwarded-For` l'IP vue par les limites, donc toutes
  contournables ; et le limiteur s'exécutant avant `authenticate`, les
  limites « par utilisateur » étaient en réalité par IP. `TRUST_PROXY` est
  faux par défaut (nombre de sauts ou liste d'IP en production), la clé par
  utilisateur vérifie elle-même le bearer (HMAC, sans base), et le TOTP compte
  ses échecs : cinq codes faux consomment le `temp_token` au login, et
  verrouillent 15 minutes (`AUTH_ACCOUNT_LOCKED`) l'activation ou la
  désactivation.

### Audit de sécurité (12/09/2026) : les six constats MEDIUM corrigés

- **Inscription en cours** : `POST /auth/register` sur un email dont
  l'inscription attend son OTP ne remplace plus le `pending` Redis (nom,
  téléphone, hash du mot de passe) et n'envoie aucun nouveau code ; réponse
  générique, la victime garde son code. `resend-otp` reste le seul moyen d'en
  obtenir un autre (5/h/email).
- **Oracles d'énumération** : `POST /auth/password/reset` vérifie d'abord le
  code (sans le consommer, un mauvais code compte une tentative) et répond
  `AUTH_OTP_INVALID` de la même façon pour un compte inconnu, sans clé ou
  avec clé ; la signature n'est examinée qu'avec un code valide
  (`AUTH_RESTORE_FAILED`, code non consommé), puis l'OTP est consommé. Les
  chemins « compte inconnu » de `reset-request` et `resend-otp` coûtent un
  hachage factice. Le 423 du login sur un compte verrouillé est conservé :
  E1-US03 veut un message de verrouillage, et il ne survient qu'après cinq
  échecs sur ce compte.
- **Signature du vault** : le message signé est désormais
  `SHA256("relais:vault:v1|catégorie|ts|" ‖ P2)` ; `ts` (ms) est obligatoire,
  dans une fenêtre de ± 5 minutes et strictement supérieur au dernier accepté
  pour l'utilisateur et la catégorie (Redis `vault:sync:ts`). Un corps
  capturé ne peut ni changer de catégorie (401) ni revenir en arrière ou être
  rejoué (409 `VAULT_SYNC_STALE`). crypto-core `syncMessage`/`buildSyncPayload`
  et app-core suivent.
- **Production** : `NODE_ENV=production` exige `EMAIL_TRANSPORT=resend`,
  `STORAGE_BACKEND=s3` et des `FRONTEND_URL`/`APP_URL` en https ; le transport
  console n'imprime qu'en `development`.
- **RGPD et purge** : la suppression d'un compte efface aussi les OTP par
  adresse (ceux d'inscription ont `user_id NULL`) ; le job `maintenance:purge`
  (horaire, :15) supprime OTP, challenges de restauration et sessions
  expirés.
- **Ouverture résiliente** : une `notification_enc` qui ne s'ouvre plus
  (rotation de clé, ligne corrompue) est journalisée (identifiant haché) et
  ignorée, à l'ouverture d'une transmission comme à la relance admin ; les
  autres contacts reçoivent leur lien.

### Audit de sécurité (12/09/2026) : les constats LOW corrigés

- **Export CSV** (`GET /admin/billing/export`) : une cellule texte qui
  commence par `=`, `+`, `-`, `@`, tabulation ou `\r` est préfixée d'une
  apostrophe (un tableur l'exécuterait comme formule) ; `\r` déclenche le
  quoting. Les montants restent bruts.
- **Activation** : un rôle détenu par moins de N contacts est refusé
  (`TRANSMISSION_NOT_CONFIGURED`, le rôle nommé) — le déverrouillage exige N
  parts par catégorie, il ne s'ouvrirait jamais. Même règle que
  `checkActivation` dans l'app.
- **Clé publique** : step-up `set_key` et écriture atomique — voir
  « `POST /auth/keys` » plus haut. **Restauration** : `POST /vault/restore`
  exige d'avoir prouvé le seed (`POST /auth/restore/verify`) dans le quart
  d'heure (Redis `auth:restore:proved`, 403 `AUTH_RESTORE_REQUIRED`) — la
  preuve prévue par DEC-06 conditionne enfin quelque chose ; l'app la faisait
  déjà avant de restaurer (`proveSeed`, extrait de `restoreWithWords`).
- **TOTP** : un code accepté brûle son pas pour ce compte (Redis
  `auth:2fa:step:u:{id}` / `a:{id}`, écriture Lua atomique, 2 minutes) —
  rejoué dans sa fenêtre il est refusé, et deux validations parallèles du
  même code ne donnent qu'une session. Activation, login, désactivation et
  login admin passent par `verifyTotpOnce`. Les secrets TOTP sont chiffrés en
  base (AES-256-GCM, `enc1:` ‖ iv ‖ tag ‖ chiffré, clé = SHA256 de
  `TOTP_ENC_KEY`, nouveau secret obligatoire de 32 caractères, distinct des
  secrets JWT et HMAC) ; une valeur legacy en clair reste lisible. Le script
  `admin:create` affiche toujours le secret base32 une fois.
- **Attestation annuelle** : challenge serveur à usage unique — voir
  « vérification annuelle » plus haut.
- **Divers** : un refus de rôle répond `AUTH_FORBIDDEN` (plus
  `AUTH_STEPUP_REQUIRED`), une seconde suppression `USER_ALREADY_DELETED`
  (plus `TRANSMISSION_ALREADY_ACTIVE`) ; sur 404 le journal porte
  `(unmatched)` au lieu de l'URL brute (un lien relay mal tapé n'y finit
  plus) ; `POST /relay/:token/verify` est plafonné à 10/min/IP devant le
  compteur de tentatives.

Après cette PR, les quinze constats de l'audit sont traités ; le 423 du login
reste un choix documenté (E1-US03).

### Relay : fin de transmission et purge

E5-US05 lu avec E5-US04 : un K1 et un K3 ont chacun leurs données. La
transmission se termine quand **chaque contact ayant répondu** a confirmé,
ou 30 jours après l'escrow pour un accès déverrouillé (job `relay:cleanup`).
Alors : P2 (`payloads/{user}/`), Si_enc (`shares/{user}/`), lignes
`escrow_shares` et clé Redis sont supprimés ; `transmissions` et
`transmission_configs` passent `completed` ; seul le log reste. Pas de job
`storj:cleanup` séparé : la purge est faite dans le même geste.

Escrow expiré sans catégorie déverrouillée : transmission `expired`, escrow
vidé, et le process repart — nouvelle ligne `transmissions`, nouveaux tokens,
nouveaux emails (E5-US03). Proposal-9 : au bout de `dms.relay_max_restarts`
expirations (3, lu dans `app_config` avec repli), il ne repart plus — la
config reste `triggered` sans transmission ouverte et le dashboard remonte
`transmission_stalled` (BO-03) ; à l'admin de joindre les contacts.

### L'owner est prévenu après le déclenchement, et peut annuler lui-même

Jusqu'au 12/09/2026, le déclenchement n'envoyait rien à l'owner : les
contacts recevaient leurs liens, les autres contacts apprenaient un blocage
ou une confirmation, et seul un admin pouvait annuler. Or un déclenchement
n'est pas une preuve de décès — c'est trois relances sans réponse — et le
coffre peut contenir les propres accès de l'owner. Décision du fondateur :

- l'owner reçoit un email (tracé dans `email_log`) et un push à chaque
  étape : `transmission_triggered` à l'ouverture, `contact_answered` quand
  un contact réussit ses questions, `contact_blocked` au cinquième échec,
  `contact_unblocked` quand un admin redonne ses tentatives (BO-02, email
  seul). Jamais d'identité de contact : l'événement seulement, et le lien
  mène à l'annulation (`notifyOwner`, migration `20260914000000`) ;
- `POST /transmission/cancel` (step-up `cancel_transmission`, neuvième
  action DEC-25) : l'owner vivant reprend la main sans attendre le support.
  Même logique que l'annulation admin (`closeTransmission`) : clé Redis et
  parts scellées purgées, transmission `cancelled` sans `cancelled_by_admin`
  et motif `owner`, liens des contacts morts (404), configuration de nouveau
  `active` avec un cycle de check-in relancé ; 409
  `TRANSMISSION_NOT_TRIGGERED` sans transmission ouverte. Les contacts
  reçoivent un `contact_progress` d'événement `cancelled` — l'annulation
  admin les prévient désormais aussi.

### Relay : l'email de déclenchement ne contient pas le message personnel

E5-US01 veut « le message personnel écrit par l'user » dans l'email. Il est
dans `secret_enc`, chiffré par K2 : le serveur ne peut pas le lire. L'email
(`transmission_contact`) porte le nom de l'owner et le lien ; le message
personnel s'affiche dans l'app, une fois K2 reconstituée.

### Journal : les écritures sont signées (DEC-31)

Le carnet est chiffré par K2 — la clé des messages personnels, le même
niveau de sensibilité que le vault. Comme `/vault/sync` (DEC-07), chaque
écriture prouve la possession de la clé de l'owner : `POST` et `PUT`
portent `signature = Ed25519.sign(SHA256(content_enc))`, `DELETE` porte
`Ed25519.sign(SHA256(id))` où `id` est l'UUID en UTF-8 minuscules, le
Wrapped signe `SHA256(stats_enc)`. Un access token volé (15 min) ne peut
donc ni réécrire une entrée, ni l'effacer, ni fausser les statistiques du
Wrapped. Même helper côté app que pour le vault et les parts Si_enc.

### Journal : une entrée par mois, rattachée au check-in

`journal_entries` est unique par (user, mois) : la seconde écriture du
mois répond 409 `JOURNAL_MONTH_TAKEN` avec l'identifiant à modifier. Un
mois passé est accepté (rattrapage), un mois futur refusé. Si un check-in
existe déjà pour le mois, l'entrée s'y rattache (`checkin_log.journal_entry_id`,
FK différée Fix-09a) ; la suppression détache sans supprimer le check-in.
Les deux ordres — check-in puis entrée, entrée puis check-in — sont testés
en transactions séparées.

### Journal : le Wrapped ne fait pas confiance à l'app pour compter (DEC-32)

Techniques §10.3 : un Wrapped n'a de sens qu'à partir de 6 entrées.
`POST /journal/wrapped/:year` compte les entrées de l'année **en base** et
refuse en dessous (409 `WRAPPED_INSUFFICIENT_ENTRIES`, `{ current,
required }`) ; `entry_count` est celui du serveur, jamais celui reçu — le
back office et la cohorte « Wrapped eligible » restent justes. `stats_enc`
reste opaque (calculé et chiffré localement). L'export image est local :
`GET …/export` ne rend que des métadonnées (année, compte, filigrane
`relais.app`), `POST …/export` date l'export.

### Admin : le premier compte naît d'un script, pas d'un endpoint

§3.8 n'a aucun endpoint de création d'admin et exige le TOTP à la
connexion. `npm run admin:create -- --email … --name … --role super_admin`
(mot de passe dans `ADMIN_PASSWORD` ou saisi) crée le compte (Argon2id,
même politique de mot de passe que les utilisateurs), génère le secret
TOTP, affiche l'URI otpauth une seule fois et écrit `ADMIN_CREATED` dans
`audit_logs`. Aucune surface HTTP. Les admins suivants passent par le même
script en V1 (Valentine seule Super Admin).

### Admin : un token à part, révocable, une grille de rôles

Le token admin a sa propre audience JWT (`admin`, 8 h) : un token
utilisateur n'ouvre jamais `/admin/*`, et inversement. Il est adossé à une
session Redis (`admin:session:{sid}`) : `logout` la supprime et le token
meurt aussitôt. Mot de passe et TOTP sont vérifiés ensemble et refusés
d'un seul 401, 5 échecs verrouillent 15 minutes. `requireRole` applique la
grille BO (support / admin / super_admin / finance) ; le super_admin passe
partout ; un refus est un 403.

### Admin : tout est audité, rien de personnel dans l'audit

Chaque mutation écrit `audit_logs` (append-only par trigger) : action du
CHECK, cible, avant/après, motif, hash d'IP. Les emails n'y figurent qu'en
SHA256 (changement d'email, regénération d'OTP), les valeurs de
configuration en clair (ce sont des paramètres, pas des données).

### Admin : la regénération d'OTP se fait par email, pas par identifiant

`POST /admin/users/:id/otp-regen` (spec) suppose une ligne `users`. Or
l'inscription attend dans Redis jusqu'à l'OTP (voir plus haut) : il n'y a
pas encore d'identifiant. L'endpoint est donc `POST /admin/users/otp-regen
{ email }` ; il renvoie le code de l'inscription en attente avec la même
limite anti-abus que l'utilisateur, et 404 sinon.

### Admin : suppression RGPD = purge + anonymisation, pas de DELETE physique

`users` est référencée par `transmissions` (sans cascade) et par les logs.
La suppression purge tout ce qui est personnel ou chiffré (stockage : P2 et
parts ; base : contacts, carnet, Wrapped, check-ins, relances, sessions,
défis, OTP, push tokens), annule les transmissions ouvertes (escrow et clé
compris), remet la configuration de transmission à zéro, puis anonymise la
ligne (`deleted-{id}@anonymized.invalid`, nom générique, téléphone et clé
publique effacés, statut `deleted`, motif, admin, date). `email_log` garde
ses hashes, `subscriptions` et `payment_events` restent (comptabilité).

### Admin : annuler une transmission rend la main à l'owner

BO-03 « Annuler » suppose l'owner vivant (vérification manuelle). La
transmission passe `cancelled`, l'escrow est purgé, les liens meurent, et
la configuration redevient `active` avec un cycle de check-in relancé —
l'owner n'a rien à reconfigurer. Relancer les contacts (`notify`) émet de
**nouveaux** liens pour ceux qui n'ont pas répondu ; les anciens meurent.

### Facturation : encaissement manuel, pas de fournisseur de paiement en V1

Aucune spec ne nomme un fournisseur (Mobile Money, carte). Inventer un
contrat de webhook sans compte marchand n'aurait rien à tester. En V1 le
client paie hors app, l'équipe enregistre le paiement :
`PUT /admin/billing/:id/plan { plan: 'premium', amount_fcfa?, provider_ref?,
reason }` — douze mois à partir de l'échéance en cours si elle est encore
devant nous (renouvellement, événement `renewed`), sinon d'aujourd'hui
(événement `created`), au prix `billing.premium_price_fcfa` sauf montant
saisi. `subscriptions` est la source de vérité, `users.plan` son miroir :
c'est ce que lisent les tokens et les limites de plan, mis à jour dans la
même transaction. Le jour où un fournisseur arrive, son webhook appellera
la même fonction.

### Facturation : la grâce conserve le premium

BO-05 parle de « jours de grâce après expiration avant suspension ». Lu
ainsi : à l'échéance le statut passe `grace`, le premium reste entier
pendant `billing.grace_period_days`, l'utilisateur reçoit la date butoir
(`subscription_expiring`) ; à la fin, `expired`, plan gratuit des deux
côtés, `subscription_expired`. Un renouvellement pendant la grâce prolonge
à partir de l'échéance ; après expiration il repart d'aujourd'hui. Une
extension admin (`POST …/extend`, sans paiement, `admin_extended`) réactive
un compte en grâce ou expiré.

### Facturation : la liste des abonnements nomme l'abonné (BO lot 3)

La liste ne portait que des identifiants. Or la finance n'a pas le module
Utilisateurs (grille §2 du Back Office) et doit retrouver qui a payé par
Mobile Money. Décision du 12/09/2026 : `GET /admin/billing/subscriptions`
rend `user_email` et `full_name` et accepte `search` (nom, email, téléphone,
même règle que `GET /admin/users`). L'export CSV, lui, reste sans email —
un fichier circule plus loin qu'un écran. Même jour, pour le back office :
`Content-Disposition` est exposé en CORS (`exposedHeaders`), sans quoi le
navigateur enregistre l'export sous un nom générique.

### Dashboard : « stockage dégradé » compté par l'API elle-même

Storj n'expose ni taux d'erreur ni usage du bucket, et l'alerte BO-01
« Storj dégradé » restait non calculée. Décision du 12/09/2026 : ce que
l'API sait, c'est quand ses propres appels échouent. Le store `fs` et `s3`
est enveloppé (`meteredStore`) : toute erreur levée par le backend (hors
« objet absent », qui rend `null`) est datée dans un sorted set Redis
(`storage:errors`, fenêtre glissante de 15 min). Le tableau de bord lève
`storage_degraded` (haute) à partir de cinq erreurs dans la fenêtre, à côté
de `service_down` qui ne voit que la sonde. L'espace du bucket reste hors de
portée : alerte à configurer chez Storj. Le seuil d'alerte d'escrow, lui,
est tranché à **12 h** (le temps de voir l'alerte et d'étendre) : la spec
BO-01 (6 h) est à corriger.

### Dashboard : « actifs 30 j » = sessions utilisées, alertes limitées à ce que la base sait

BO-01 compte les « comptes ayant ouvert l'app dans les 30 derniers jours ».
Le schéma n'a aucune trace d'ouverture ; `sessions.last_used_at` est mis à
jour à chaque rafraîchissement de token (toutes les 15 minutes d'usage) —
c'est la mesure retenue, sans migration ni écriture supplémentaire. Le taux
de check-in est la part des transmissions **actives** dont l'échéance n'est
pas dépassée (null sans transmission active). Les revenus du mois viennent
des mêmes événements que BO-07.

Sur les sept alertes de la spec, trois supposent des métriques
d'infrastructure que rien ne collecte (taux d'erreur Storj et API, espace
Storj). Le dashboard livre celles que la base et `/health` permettent :
service indisponible (PostgreSQL, Redis, Storj, HCV quand il est configuré),
escrow à moins de 12 h, transmission au point mort (Proposal-9), plus de 3
contacts bloqués dans l'heure (déduit de `blocked_until`), comptes suspendus depuis
plus de 24 h. Les autres sont consignées dans `docs/open-questions.md`.

### Tickets : ouverts sans compte, parce que ceux qui en ont besoin ne peuvent pas se connecter

BO-02 décrit deux cas de support sur trois — compte verrouillé, OTP jamais
reçu — où l'utilisateur ne peut pas s'authentifier. Un ticket exigeant un
token ne les servirait jamais. `POST /support/tickets` accepte donc un
email sans token, limité à 3 par heure et par IP (la limite compte aussi
les essais invalides : elle se joue avant la validation). Le ticket est
rattaché au compte si l'email correspond, sans que la réponse le dise ;
avec un token, l'identité vient du compte et l'email envoyé est ignoré.
Côté back office, le rôle support voit l'email du demandeur (c'est son
métier), l'audit ne garde que des identifiants. `TICKET_UPDATE` et la
cible `ticket` ont demandé une migration du CHECK de `audit_logs`
(`20260430000000_audit_ticket_update`) — BO-06 exige que toute action soit
journalisée, la liste v1.3 ne prévoyait rien pour les tickets.

### Codes de récupération 2FA : rendus une fois, consommés au login

E6-US02 et Schéma v1.4 (Point-2). `POST /auth/2fa/verify` (activation)
rend 8 codes `xxxxx-xxxxx` (alphabet sans caractères ambigus, 50 bits
chacun) et stocke `SHA256(code)` dans `two_factor_recovery_codes`. Au
login, `POST /auth/2fa/verify { temp_token, recovery_code }` remplace le
code TOTP — casse indifférente, un code ne sert qu'une fois (`used_at`),
`code` et `recovery_code` s'excluent. La désactivation et la suppression
RGPD purgent les codes. Pas de regénération en V1 : désactiver puis
réactiver la 2FA. Backend v1.1 §2.1 ne prévoyait aucun endpoint — choix
consigné dans `docs/open-questions.md` §D.1.

## 4. Ce que le serveur ne voit jamais

| | |
|---|---|
| Seed, 12 mots | jamais transmis — `POST /auth/seed/display` ne renvoie que `{ authorized: true }` |
| PIN | jamais transmis — le step-up est une confiance déléguée (DEC-25) |
| K1 / K2 / K3 | jamais transmis |
| Adresse email dans les logs | `email_log.recipient_hash` est un SHA256 ; les logs Pino hachent userId et IP |
| Mot de passe | Argon2id, 64 MiB / 3 passes |
| Email et téléphone des contacts | scellés vers la clé de Relais (DEC-28) ; ouverts en mémoire à la création (forme) et à l'activation (envoi), jamais stockés en clair, jamais loggés |
| Parts Shamir, `secret_enc`, `verify_token` | blobs opaques ; le serveur n'en connaît que la taille et le hash |
| Réponses aux questions secrètes, K_i | jamais transmis — la vérification annuelle est une attestation signée |
| Réponse au mini-jeu | comparée en mémoire, jamais stockée ; seul le nombre de tentatives est conservé |
| Réponses des contacts, K_i | jamais transmis (E5-US02) ; l'app dépose les parts Si, pas ce qui les ouvre |
| Parts Si en escrow | scellées par une clé éphémère Redis ; jamais combinées par le serveur ; supprimées à la fin |
| Tokens de relay | HMAC en base, le token clair ne vit que dans l'email |
| Carnet de vie, Wrapped | `content_enc` et `stats_enc` opaques (K2) ; le serveur ne connaît que mois, mode, question, taille approximative |
| Back office | métadonnées seulement : jamais un blob, jamais l'identité d'un contact, emails hachés dans l'audit |

## 5. Vérifications

266 tests d’intégration, sur PostgreSQL 16 et Redis réels, base reconstruite
depuis les migrations et le seed à chaque run. Chaque test repart d'une base
et d'un stockage vides. Ils couvrent notamment :

- rien en base avant l'OTP ; user + subscription après
- attributs du cookie refresh (`Path`, `HttpOnly`, `SameSite=Strict`)
- OTP invalidé après 5 échecs, même avec le bon code ensuite
- resend invalide l'ancien code
- réponses génériques : email déjà pris, compte inexistant, reset-request inconnu
- verrou 15 min après 5 échecs de mot de passe, email envoyé, bon mot de passe refusé pendant le verrou
- rotation du refresh token, replay de l'ancien refusé
- révocation immédiate après logout, changement et réinitialisation de mot de passe
- compte suspendu coupé sur un token encore valide
- step-up : absent → `AUTH_STEPUP_REQUIRED`, mauvaise action → refusé **sans consommer le jti**, replay → refusé, token d'un autre utilisateur → refusé
- clé publique : 32 bytes exigés, step-up `set_key`, enregistrement unique, deux enregistrements parallèles → un seul gagne
- restauration : bonne signature → vérifié + email ; mauvaise clé → refusé et challenge brûlé ; expiré → refusé ; `POST /vault/restore` refusé sans preuve du seed
- reset avec clé : signature obligatoire, mauvaise signature n'entame pas l'OTP
- 2FA : activation, login en deux temps, `temp_token` à usage unique, désactivation avec step-up ; codes de récupération : 8 rendus une fois et hachés, un code remplace le TOTP, usage unique, purgés à la désactivation ; un code TOTP ne sert qu'une fois (rejeu refusé, validations parallèles → une session) ; secret chiffré `enc1:` en base, legacy en clair lisible
- rate limit : en-têtes exposés, 429 dans l'enveloppe
- vault : sync sans clé publique → `AUTH_KEY_NOT_SET` ; signature d'une
  autre clé → refusé ; **blob modifié après signature → refusé** ;
  `vault.max_size_mb` lu dans `app_config` et appliqué ; écrasement par
  catégorie ; sync-status vide puis renseigné ; restore rend les octets
  intacts ; catégorie absente → `NOT_FOUND` ; un utilisateur ne voit jamais
  le backup d'un autre
- transmission (49 tests, écrits **avant** le code) : `relais-key` public et
  cacheable ; Note-01 (journal, score < 6, doublon, inconnue → 400 avec les
  identifiants) ; aucun rôle → 400 ; limites de plan 2 / 5, contact retiré
  non compté ; signature d'une autre clé → 401 ; sealed box vers une autre
  clé → 400 ; sans clé publique → 409 ; PUT/DELETE avec step-up, 404 hors
  périmètre, position jamais réattribuée ; schéma et délais hors catalogue
  → 400 ; activation : < 2 contacts, M > contacts, sans K1 → 409 ; part
  manquante ou en trop → 400 ; contact absent du corps → 400 ; **une seule
  signature de part invalide → 401 et rien n'est persisté** (ni objet, ni
  statut, ni email) ; activation réussie : parts sur le stockage au chemin
  serveur, hash et `verify_token` en base, check-in planifié, deux emails
  tracés par hash ; seconde activation → 409 ; contacts et schéma figés ;
  pause 30 jours, plafond `dms.pause_max_months`, reprise réarme le
  check-in ; désactivation purge les parts et rend les contacts modifiables ;
  vérification annuelle signée, mauvaise clé → 401, avant activation → 409 ;
  Proposal-8 : hash en clair mal signé → 401 sans rien écrire, hashes en
  base par rôle ; email `contact_designated` avec le prénom de la sealed box ;
  bibliothèque de questions filtrée (journal, score < 6, archivée exclues),
  session exigée ; `secret_enc` relu dans la config
- check-in (19 tests, test-first) : statut inactif / actif / en retard ;
  jeu refusé sans transmission active, défi sans la réponse, identique tant
  qu'il est en cours, mauvaise réponse comptée sans pénalité, bonne réponse
  → jeton, casse/accents/espaces tolérés, 11ᵉ réponse → 429 ; jeton inconnu
  ou rejoué → 401 ; premier check-in → ligne, streak 1, `first_checkin`,
  échéance replanifiée, relances à zéro ; second du même mois → pas de
  ligne ; streak prolongé → `streak_3` ; mois sauté → 1 ; entrée de carnet
  inconnue → 404 ; streak courant / record / badges ; historique trié
- push (6 tests, lot 5) : `POST/DELETE /auth/push-token`, `pushService`
  (alias haché, rien sans abonnement, rien d'identifiant), `OneSignalTransport`
  contre un faux serveur HTTP
- dead man's switch (13 tests) : rien avant J+7 ; J+7 → relance 1 tracée,
  pas de doublon le lendemain ; J+14 et J+21 → relances 2 et 3 ; intervalles
  lus dans `app_config` ; pause ignorée ; trois relances sans silence écoulé
  → rien ; silence écoulé + trois relances → `triggered`, puis plus balayé ;
  silence écoulé mais relances incomplètes → relance d'abord ; BullMQ :
  deux jobs planifiés (`0 9 * * *`, `30 * * * *`), démarrage idempotent,
  arrêt propre
- relay (27 tests, test-first) : ouverture au déclenchement (ligne
  `transmissions`, escrow = `dms.escrow_ttl_hours`, un token HMAC par
  contact, emails, idempotent ; le job quotidien enchaîne balayage et
  ouverture) ; lien inconnu / expiré / clos → 404, bloqué → 423, aucune
  fuite (ni id owner ni email) ; cinq échecs → 429 puis 423, déblocage
  automatique ; envois malformés comptés ; part acceptée → escrow scellé,
  clé Redis avec TTL, `answered`, `in_progress`, `RELAY_ALREADY_ANSWERED` ;
  N parts → catégorie déverrouillée, clé prolongée à 30 jours ; `data`
  refusé avant déverrouillage ou sans réponse, puis parts + P2 +
  `secret_enc`, escrow expiré → 409 ; `confirm` : refusé sans réponse,
  purge totale au dernier confirmé, lien clos, 3/min/IP ; Proposal-8 : part
  qui ne correspond pas au hash signé → 422 comptée comme un échec, la
  bonne part passe ensuite ; Proposal-9 : blocage et confirmation
  intermédiaire → `contact_progress` aux autres contacts, pas au bloqué ni
  à la confirmation finale ; cleanup : rien avant l'échéance, expiré →
  nouveaux liens, troisième expiration → arrêt (config `triggered`, aucune
  transmission ouverte, aucun email), accès à 30 jours puis purge
- journal (21 tests, test-first) : question du mois par mode, `free` sans
  question, mode inconnu → 400 ; création avec métadonnées en clair et
  blob opaque, mois passé accepté, futur refusé, signature d'une autre
  clé → 401, sans clé → 409, second du mois → 409, question secrète
  refusée ; check-in puis entrée → rattachée, suppression → détachée ;
  liste sans contenu triée, détail avec contenu, lecture par mois (404 si
  vide, 400 si mal formé), entrée d'un autre → 404
  sur GET/PUT/DELETE ; PUT signé, mauvaise clé refusée sans modifier ;
  DELETE sans signature → 400, mauvaise clé → 401, bonne → supprimée ;
  Wrapped : < 6 → 409 `{ current, required }`, 6 → 201 avec compte
  serveur, régénération → 200 et compte mis à jour, signature → 401,
  année hors bornes → 400, GET 404 puis 200, export sans contenu, POST
  export daté
- admin (25 tests, test-first) : bootstrap (Argon2id, TOTP, audit ;
  mot de passe faible, rôle inconnu, email pris → refus) ; login TOTP,
  `ADMIN_LOGIN`, un seul 401 pour mot de passe ou code faux, verrouillé →
  423, suspendu → 403, 5/15 min/IP ; token utilisateur refusé, logout
  immédiat ; utilisateurs : liste filtrée sans champ sensible, fiche en
  chiffres, finance → 403, débloquer (compteurs, suspension, email,
  audit), OTP regénéré (ancien mort, audit sans email), suspendre
  (transmission en pause, 403 pour support), email (audit en hashes,
  409), RGPD (purge stockage et données, transmission annulée, ligne
  anonymisée, codes de récupération purgés, second appel → 409) ; transmissions : liste et détail sans
  identité, escrow +24/+48 h puis 409, relance avec nouveaux liens,
  annulation (config rendue active), déblocage de contact ; questions :
  liste, ajout, doublon → 409, catégorie inconnue → 400, modification
  auditée, archivage (usage conservé, plus proposée) ; config : lecture
  typée, mauvais type → 400, clé inconnue → 404, avant/après audité, effet
  immédiat ; audit filtrable ; santé admin
- facturation (12 tests, test-first) : support → 403, finance → 200 ;
  premium 12 mois au prix du catalogue, `created`, `users.plan` et
  `/auth/me` synchronisés, `PLAN_CHANGE` audité ; renouvellement à partir
  de l'échéance, `renewed`, montant explicite ; rétrogradation immédiate,
  `admin_downgraded`, free → free refusé ; extension : jours ajoutés,
  compteur, `admin_extended`, un expiré redevient actif d'aujourd'hui,
  0 jour → 400, inconnu → 404 ; liste filtrable sans email ; job : premium
  valide intact, échéance → grâce + événement + email une seule fois,
  grâce écoulée → expiré + plan gratuit + email, idempotent, renouvellement
  après expiration = `created`, `billing.grace_period_days` lu ; overview
  exact (3 premium dont 1 en grâce, MRR 2 500, 1 renouvellement, 1 churn,
  39 000 FCFA) ; export CSV en pièce jointe, période vide, bornes inversées
  → 400
- dashboard (5 tests, test-first) : support et finance → 403 ; les huit
  KPIs exacts sur un jeu de six comptes (supprimé exclu, dormant exclu des
  actifs, déclenchée et complétée du mois, taux de check-in 50 %, revenus,
  ticket ouvert) ; taux null sans transmission active ; aucune alerte au
  calme ; escrow expirant + pic de blocages + suspension ancienne, triées
- tickets (6 tests, test-first) : création sans compte rattachée au compte
  sans le dire, email inconnu accepté, ni email ni token → 400, corps
  validé, 3/h/IP ; avec token l'email est ignoré, liste des siens
  seulement, 401 sans token ; back office : liste filtrée, détail avec
  email, finance → 403, prise en charge puis résolution avec `resolved_at`,
  deux lignes d'audit avant/après sans email, visible par l'utilisateur,
  corps vide → 400, assigné inconnu → 404
- dashboard : alerte `transmission_stalled` (config déclenchée, 3 escrows
  expirés, aucune transmission ouverte)
- bout en bout avec le cœur crypto de l'app (`e2e-crypto-core`, voir
  `docs/crypto-core.md` §5) : de l'inscription à la reconstitution
  post-mortem, chaque corps produit par `@relais/crypto-core`
- client API partagé (`api-client`, 3 tests, serveur sur un port éphémère) :
  enveloppe, erreurs typées, refresh automatique sur 401 puis rejeu,
  logout, step-up — voir `docs/mobile.md` §5
- logique de l'app (`app-core`, 4 tests contre l'API réelle) : onboarding
  complet, restauration par les 12 mots, mot de passe oublié et changement,
  TOTP et codes de récupération — voir `docs/mobile.md` §5
- coffre de l'app (`app-core-vault`, contre l'API réelle) : sync par
  catégorie, statut, P2 opaque sur le stockage, restauration sur nouveau
  device — voir `docs/mobile.md` §5
- check-in et carnet de l'app (`app-core-checkin`, 5 tests contre l'API
  réelle) : jeu et validation, carnet chiffré et signé, Wrapped calculé côté
  app — voir `docs/mobile.md` §5
- audit HIGH (7 tests) : confirmation refusée sans catégorie déverrouillée et
  rien de purgé ; annulation admin puis nouveau silence → nouvelle
  transmission, anciens liens clos, idempotent ; `X-Forwarded-For` sans effet
  sur le limiteur ; limite par utilisateur distincte par compte sur une même
  IP ; cinq TOTP faux consomment le `temp_token` puis verrouillent la
  désactivation 15 min ; `parseTrustProxy`
- parcours du contact (`app-core-relay`, 2 tests contre l'API réelle) :
  lien, réponses vérifiées sur le device, attente, déverrouillage 2-of-2,
  checklist, message, carnet, progression, « J'ai terminé », purge ;
  blocage après cinq échecs — voir `docs/mobile.md` §5
- transmission de l'app (`app-core-transmission`, 3 tests contre l'API
  réelle) : contacts, activation avec parts calculées côté app, parcours
  désactiver → modifier → réactiver, vérification annuelle, pause,
  restauration des contacts sur nouveau device — voir `docs/mobile.md` §5
- secrets (6 tests) : production sans HCV → refus au démarrage, clé de dev
  interdite en production, hors production clé de dev ou HCV exigés ; faux
  HCV en HTTP local : lecture KV v2 à `/v1/<path>` avec `X-Vault-Token`,
  403 ou champ absent → erreur sans repli, `/health` → `ok` / `down` /
  `unconfigured`, la clé publique servie vient bien de HCV

```bash
scripts/dev-services.sh start     # PostgreSQL + Redis jetables
npm test --workspace apps/api
```
