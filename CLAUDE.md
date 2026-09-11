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
  `src/services/` (email, stockage objet, secrets).
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
- Une branche par lot, une PR par module, mergée par le fondateur. Chaque
  commit passe `typecheck`, `lint` et la suite complète.
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

Logs API (aucune table), fournisseur de paiement (encaissement manuel en
V1), enregistrement Arbitrum, app mobile, interface du back office. La liste à jour est dans le README et `docs/backend.md` §2.
