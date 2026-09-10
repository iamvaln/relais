# RELAIS — Backend : notes d'implémentation

**Specs de référence** : Backend Specs v1.1 + patch DEC-28/29/30, Specs
Techniques v1.2 + patch, Journal des Décisions v1.0 + Addendum v1.1 + patch
(DEC-28 à DEC-30), Schéma PostgreSQL v1.3.

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
    jobs/deadman.ts          balayage quotidien : relances, déclenchement
    jobs/queue.ts            BullMQ — job planifié deadman:checkin
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
| `POST /auth/keys` | **Ajout** — voir §3 |
| `PUT /auth/password` | Step-up, ancien mot de passe, révoque les autres sessions |
| `POST /auth/password/reset-request` | Réponse générique |
| `POST /auth/password/reset` | OTP + signature Ed25519 — voir §3 |
| `GET /auth/restore/challenge` | DEC-06 |
| `POST /auth/restore/verify` | DEC-06 |
| `POST /auth/2fa/setup` · `verify` · `DELETE /auth/2fa` | E6-US02 |
| `POST /vault/sync` | Blob chiffré + signature Ed25519 (DEC-07), taille plafonnée par `vault.max_size_mb` |
| `GET /vault/sync-status` | Date et taille par catégorie, lues sur le stockage |
| `POST /vault/restore` | Renvoie le blob tel quel |
| `GET /transmission/relais-key` | **Public**, 60/min/IP, cache 24 h — DEC-28 |
| `GET /transmission/config` | État complet, contacts inclus (jamais `removed`) |
| `POST /transmission/contacts` | Note-01, limite de plan, signature et sealed box vérifiées |
| `PUT /transmission/contacts/:id` | Step-up `edit_contacts`, mêmes règles |
| `DELETE /transmission/contacts/:id` | Step-up `edit_contacts`, retrait logique |
| `PUT /transmission/schema` | Step-up `edit_contacts`, N ≥ 2, M ≥ N |
| `PUT /transmission/config` | Step-up `edit_transmission`, DEC-22 |
| `POST /transmission/activate` | Step-up `activate_transmission` — DEC-29, DEC-30, voir §3 |
| `POST /transmission/pause` · `DELETE /transmission/pause` | E4-US04, 7 / 30 / 90 jours, plafond `dms.pause_max_months` |
| `DELETE /transmission` | Step-up `delete_transmission`, parts purgées |
| `POST /transmission/contacts/:id/verify` | Vérification annuelle — attestation signée, voir §3 |
| `GET /checkin/status` | Échéance, retard en jours, relances, « validé ce mois » |
| `GET /checkin/game` · `POST /checkin/game/answer` | Défi côté serveur, 10 réponses/h/user (§7.1) — voir §3 |
| `POST /checkin/complete` | Consomme le jeton du jeu ; ligne du mois, streak, badge ; replanifie l'échéance |
| `GET /checkin/history` · `GET /checkin/streak` | Log des mois validés ; streak courant, record, badges |

Jobs (§4) : `deadman:checkin` quotidien à 09:00 UTC via BullMQ, worker dans
le processus API derrière `JOBS_ENABLED=true`. Il envoie les relances et
marque `triggered` ; voir §3.

Non livré : `/user/*`, `PUT /transmission/recipients` (sans objet depuis
DEC-23), `/journal/*`, `/relay/*`, `/admin/*`, `deadman:trigger` (tokens et
emails aux contacts — module relay), `storj:cleanup`, l'enregistrement
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
(DEC-24). Ajoutés par la migration `20260425000000`, proposés pour la spec
v1.4 — voir `docs/open-questions.md`.

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

DEC-30 : la clé privée est lue **uniquement** par
`services/secrets` (`getRelaisX25519Sk()`), depuis `RELAIS_X25519_SK` (hex
64 ou base64 44) en dev et test ; brancher HashiCorp Vault
(`relais/x25519_sk`) en prod se fera dans ce seul module.

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
`docs/open-questions.md`.

### Transmission : l'email de désignation réutilise `transmission_contact`

DEC-30 envoie un email à chaque contact dès l'activation. `email_log` ne
connaît qu'un type pour les contacts, `transmission_contact`, dont le texte
est écrit pour le déclenchement (« suivez ce lien »). Il est réutilisé tel
quel avec `link = FRONTEND_URL/contact`, sans nom d'owner (le serveur n'en
a pas). Un texte de désignation dédié est à écrire — point ouvert.

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
peut que dater l'attestation. `GET /config` expose `verify_token` à l'owner,
et `POST /contacts/:id/verify` exige `Ed25519.sign(SHA256(verify_token))`
avec la clé de l'owner — même preuve de possession que le vault (DEC-07).
Sans cela, n'importe quel porteur d'access token pourrait « vérifier ».

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

### Codes de récupération 2FA : pas de table

E6-US02 : « des codes de récupération d'urgence sont générés et affichés une
fois ». Le schéma n'a aucune table pour les stocker, et `users` n'a pas de
colonne. Non implémenté ; consigné dans `docs/open-questions.md`. Tant que ça
manque, perdre son authenticateur signifie passer par le support.

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

## 5. Vérifications

113 tests d'intégration, sur PostgreSQL 16 et Redis réels, base reconstruite
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
- clé publique : 32 bytes exigés, enregistrement unique
- restauration : bonne signature → vérifié + email ; mauvaise clé → refusé et challenge brûlé ; expiré → refusé
- reset avec clé : signature obligatoire, mauvaise signature n'entame pas l'OTP
- 2FA : activation, login en deux temps, `temp_token` à usage unique, désactivation avec step-up
- rate limit : en-têtes exposés, 429 dans l'enveloppe
- vault : sync sans clé publique → `AUTH_KEY_NOT_SET` ; signature d'une
  autre clé → refusé ; **blob modifié après signature → refusé** ;
  `vault.max_size_mb` lu dans `app_config` et appliqué ; écrasement par
  catégorie ; sync-status vide puis renseigné ; restore rend les octets
  intacts ; catégorie absente → `NOT_FOUND` ; un utilisateur ne voit jamais
  le backup d'un autre
- transmission (46 tests, écrits **avant** le code) : `relais-key` public et
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
  vérification annuelle signée, mauvaise clé → 401, avant activation → 409
- check-in (19 tests, test-first) : statut inactif / actif / en retard ;
  jeu refusé sans transmission active, défi sans la réponse, identique tant
  qu'il est en cours, mauvaise réponse comptée sans pénalité, bonne réponse
  → jeton, casse/accents/espaces tolérés, 11ᵉ réponse → 429 ; jeton inconnu
  ou rejoué → 401 ; premier check-in → ligne, streak 1, `first_checkin`,
  échéance replanifiée, relances à zéro ; second du même mois → pas de
  ligne ; streak prolongé → `streak_3` ; mois sauté → 1 ; entrée de carnet
  inconnue → 404 ; streak courant / record / badges ; historique trié
- dead man's switch (9 tests) : rien avant J+7 ; J+7 → relance 1 tracée,
  pas de doublon le lendemain ; J+14 et J+21 → relances 2 et 3 ; intervalles
  lus dans `app_config` ; pause ignorée ; trois relances sans silence écoulé
  → rien ; silence écoulé + trois relances → `triggered`, puis plus balayé ;
  silence écoulé mais relances incomplètes → relance d'abord ; BullMQ :
  un seul job planifié `0 9 * * *`, démarrage idempotent, arrêt propre

```bash
scripts/dev-services.sh start     # PostgreSQL + Redis jetables
npm test --workspace apps/api
```
