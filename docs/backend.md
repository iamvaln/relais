# RELAIS — Backend : notes d'implémentation

**Specs de référence** : Backend Specs v1.1, Specs Techniques v1.2, Journal des
Décisions v1.0 + Addendum v1.1, Schéma PostgreSQL v1.3.

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
    api/health/              GET /health
    api/auth/                schemas, service, routes
    api/vault/               sync, sync-status, restore
  test/                      Vitest + Supertest sur PostgreSQL et Redis réels
scripts/dev-services.sh      PostgreSQL 16 + Redis jetables, migrations + seed
```

Stack telle que spécifiée (§1.1) : Node 22, Fastify 5, TypeScript strict,
Prisma 6 sur le schéma racine, ioredis, Vitest + Supertest, Pino.

## 2. Périmètre livré

Le module **auth** de §3.1 v1.1, le module **vault** de §3.3 v1.1, et `/health` :

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

Non livré : `/user/*`, `/transmission/*`, `/checkin/*`, `/journal/*`,
`/relay/*`, `/admin/*`, les jobs BullMQ.

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

## 5. Vérifications

39 tests d'intégration, sur PostgreSQL 16 et Redis réels, base reconstruite
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

```bash
scripts/dev-services.sh start     # PostgreSQL + Redis jetables
npm test --workspace apps/api
```
