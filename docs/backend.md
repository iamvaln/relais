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
    api/health/              GET /health
    api/auth/                schemas, service, routes
  test/                      Vitest + Supertest sur PostgreSQL et Redis réels
scripts/dev-services.sh      PostgreSQL 16 + Redis jetables, migrations + seed
```

Stack telle que spécifiée (§1.1) : Node 22, Fastify 5, TypeScript strict,
Prisma 6 sur le schéma racine, ioredis, Vitest + Supertest, Pino.

## 2. Périmètre livré

Tout le module **auth** de §3.1 v1.1, plus `/health` :

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

Non livré : `/user/*`, `/vault/*`, `/transmission/*`, `/checkin/*`,
`/journal/*`, `/relay/*`, `/admin/*`, les jobs BullMQ.

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

28 tests d'intégration, sur PostgreSQL 16 et Redis réels, base reconstruite
depuis les migrations et le seed à chaque run. Chaque test repart d'une base
vide. Ils couvrent notamment :

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

```bash
scripts/dev-services.sh start     # PostgreSQL + Redis jetables
npm test --workspace apps/api
```
