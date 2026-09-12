# Relais — repères pour travailler dans ce dépôt

Relais est un service de transmission du patrimoine numérique (Cameroun
d'abord, FR/EN). Principe non négociable : **le serveur ne lit jamais une
donnée utilisateur en clair**. Coffre, questions secrètes, messages, carnet,
parts Shamir : des blobs opaques chiffrés sur le device. Toute PR qui ajoute
une colonne ou un log lisible contenant de la donnée utilisateur doit le
justifier explicitement.

## Où sont les choses

- `prisma/` — schéma PostgreSQL. **Les migrations SQL sont la source de
  vérité** (CHECK, index partiels, FK différées, trigger d'audit) ;
  `schema.prisma` est régénéré par `prisma db pull`, jamais édité à la main.
  Seed `prisma/seeds/`, tests SQL `prisma/tests/`.
- `apps/api/` — l'API Fastify 5 / TypeScript strict / Prisma 6. Un dossier
  par module dans `src/api/*` (`schemas.ts` JSON Schema, `service.ts`,
  `routes.ts`), jobs BullMQ dans `src/jobs/`, services partagés dans
  `src/services/` (email, push OneSignal, stockage objet, secrets).
- `packages/crypto-core/` — le cœur crypto de l'app mobile (seed BIP39,
  K1/K2/K3, Ed25519, XChaCha20, Shamir GF(256), contacts, relay, carnet).
  Pur TypeScript, ni UI ni réseau ; `libsodium-wrappers-sumo` (Argon2id).
  Tests unitaires dans `test/`, bout en bout contre l'API dans
  `apps/api/test/e2e-crypto-core.test.ts`. Notes : `docs/crypto-core.md`.
- `packages/api-client/` — client TypeScript de l'API (enveloppe, bearer,
  refresh sur 401, step-up), partagé par le mobile et le back office web ;
  testé contre l'API réelle dans `apps/api/test/api-client.test.ts`.
- `packages/app-core/` — la logique de l'app sans React Native : politique
  PIN et backoff (DEC-26), device (`seed_enc_pin`, biométrie), onboarding,
  connexion, restauration, mot de passe, TOTP, coffre local (`vault/` :
  fiches chiffrées dans SQLite, sync 3 s par catégorie, restauration),
  transmission (`transmission/` : contacts chiffrés sur le device, réponses
  secrètes jamais envoyées, activation, vérification annuelle, pause),
  check-in (`checkin/`) et carnet (`journal/` : entrées sous K2 déchiffrées
  à la lecture, Wrapped calculé sur le device).
  Tests sous Node dans `test/` (vraie SQLite via `node:sqlite`), parcours
  contre l'API réelle dans `apps/api/test/app-core*.test.ts`.
- `apps/mobile/` — l'app React Native (Expo SDK 57, Expo Router, Zustand,
  TanStack Query). Logique hors des écrans (`src/state`, `src/lib`, `src/i18n`)
  testée sous Node avec Vitest ; écrans minces dans `app/`. Imports relatifs
  sans extension (Metro), `Buffer` polyfillé, alias libsodium dans
  `metro.config.js` ; `npx expo export` vérifie le bundle. Notes, lots et
  décisions : `docs/mobile.md`.
- `docs/backend.md` — décisions et écarts par rapport aux specs, par module.
  **À lire avant de toucher un module.** `docs/open-questions.md` — points
  tranchés et points ouverts, numérotés. `docs/specs/` — les specs en
  markdown (les patchs DEC-28 à DEC-30 sont annexés en fin de fichier).

## Comment on travaille

- **Test-first, sans exception** : test rouge vérifié rouge pour la bonne
  raison, code minimal, vert, refactor. Les tests sont des tests
  d'intégration Vitest + Supertest sur PostgreSQL et Redis réels
  (`apps/api/test/*.test.ts`), jamais de mock de la base.
- Un design court et les décisions à trancher sont présentés au fondateur
  avant le premier test ; chaque décision est ensuite consignée dans
  `docs/backend.md` et `docs/open-questions.md`.
- Une branche par lot, une PR par module. Consigne du fondateur
  (11/09/2026) : la PR est mergée dès que la CI est verte et qu'aucun
  commentaire n'est ouvert, sans attendre ; la branche est ensuite réalignée
  sur `main` et le lot suivant démarre. Chaque commit passe `typecheck`,
  `lint` et la suite complète.
- Conventions API : enveloppe `{ success, data | error: { code, message,
  details } }`, codes dans `src/lib/errors.ts`, `additionalProperties:
  false` partout, `authenticate` puis `requireStepUp(action)` sur les
  actions sensibles (DEC-25), `authenticateAdmin` + `requireRole` côté back
  office, limites de débit dans `src/plugins/rate-limit.ts`. Les params de
  route ne sont pas coercés : les nombres arrivent en texte validé.
- Preuves de possession : les écritures de données chiffrées (vault,
  carnet, parts) portent une signature Ed25519 de la clé de l'owner
  (DEC-07, DEC-29, DEC-31).
- Logs et audit : jamais d'email, de token ni de blob ; les identifiants et
  IP sont hachés.

## Lancer

```bash
npm install
scripts/dev-services.sh start        # PostgreSQL 16 + Redis jetables (55432 / 55379)
npm run db:generate
npm test                             # base recréée depuis les migrations à chaque run
npm run typecheck && npm run lint
npm run dev                          # http://localhost:3000/health
npm run admin:create -w apps/api -- --email … --name … --role super_admin
```

Les services de dev s'arrêtent parfois avec le conteneur : `pg_isready -h
localhost -p 55432 || scripts/dev-services.sh start` avant les tests.

## Ce qui n'est pas fait

Logs API (export externe), fournisseur de paiement (encaissement manuel en
V1), enregistrement Arbitrum, app mobile lot 6 (parcours du contact — socle,
cœur crypto, onboarding, sécurité, coffre, transmission, check-in et carnet
sont faits), interface du back office. La liste à jour est dans le README et `docs/backend.md` §2.
