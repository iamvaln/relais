# Relais

> Passe le relais, pas le chaos.

Transmission du patrimoine numérique : coffre chiffré côté client, contacts
de confiance, et déclenchement automatique par dead man's switch.

## État du projet

Phase de conception. Le schéma PostgreSQL est la première brique
d'implémentation.

| Livrable | État |
|---|---|
| Specs produit, techniques, backend, frontend, back office | ✅ v1 (`docs/specs/`) |
| Schéma PostgreSQL v1.4 | ✅ Implémenté et testé (`prisma/`), Proposals 8 et 9 incluses |
| API backend — auth, vault, transmission, check-in, relay, journal, admin, facturation, dashboard, tickets, jobs | ✅ 96 endpoints, 343 tests d'intégration (`apps/api/`) |
| Cœur crypto de l'app (seed, clés, coffre, Shamir, contacts, relay, carnet) | ✅ `packages/crypto-core`, 32 tests + 1 bout en bout contre l'API |
| Client API partagé (mobile, back office web) | ✅ `packages/api-client`, testé contre l'API |
| Logique de l'app (PIN, device, onboarding, session, coffre, transmission, check-in, carnet, parcours du contact) | ✅ `packages/app-core`, testé sous Node et contre l'API |
| App mobile — lots 1 à 6 : socle, onboarding et sécurité, coffre, transmission, check-in et carnet, parcours du contact | ✅ `apps/mobile` ; décisions dans `docs/mobile.md` |
| Page web du contact (pour qui n'installe pas l'app) | ✅ `apps/web-relay`, Vite, même logique que l'app (`app-core`) |
| API backend — logs API, fournisseur de paiement | ⬜ À faire |
| Back office (interface) | ✅ Lots 1 à 3 (connexion TOTP, tableau de bord, utilisateurs, transmissions, questions, configuration, facturation, tickets, monitoring) — `packages/admin-core` + `apps/web-admin` (React, Vite), décisions dans `docs/backoffice.md` |
| Smart contract Arbitrum | 🟨 Lot 1 : contrat `contracts/src/RelaisDms.sol` (48 tests Foundry) ; lot 2a : le miroir côté API (`apps/api/src/services/chain`, signatures owner vérifiées, file `chain_sync`, réconciliation, alertes, Anvil en CI) ; lot 2b (mode autonome, IPFS) et lot 3 (clients) à écrire — design dans `docs/smart-contract-v2.md` |

## Documentation

- [`docs/backend.md`](docs/backend.md) — notes d'implémentation de l'API :
  décisions, écarts par rapport aux specs, vérifications
- [`docs/schema-postgresql.md`](docs/schema-postgresql.md) — notes
  d'implémentation du schéma : l'écart trouvé dans la spec, les vérifications
  passées, ce qui reste à faire
- [`docs/crypto-core.md`](docs/crypto-core.md) — le cœur crypto de l'app :
  modules, décisions, ce que l'app mobile doit encore brancher
- [`docs/mobile.md`](docs/mobile.md) — l'app mobile : stack, lots, décisions
  (parcours contact web + deep link, OneSignal), comment la lancer
- [`docs/open-questions.md`](docs/open-questions.md) — points tranchés par les
  specs, écarts de contrat entre la révision de septembre 2026 et l'API, et
  ce qui reste à trancher
- [`docs/specs/errata-2026-09.md`](docs/specs/errata-2026-09.md) — ce qu'il reste à
  corriger dans les `.docx`, document par document, pour qu'ils décrivent l'API livrée
- [`docs/specs/`](docs/specs/) — les 10 documents de spec convertis en markdown
  (sources `.docx` dans `specs/`)

## Schéma

La spec `specs/Relais_Schema_PostgreSQL_v1.docx` (v1.4) fait foi. Elle est
implémentée en SQL — **le DDL est la source de vérité**, parce que les CHECK
constraints, les index partiels, la FK différée et le rôle `audit_writer` ne
sont pas exprimables en Prisma. `schema.prisma` en est un miroir généré, à ne pas
éditer à la main.

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/relais"

# Appliquer (dans cet ordre). Chaque migration est atomique et sort en
# exit non nul au premier échec — la boucle s'arrête proprement.
for m in prisma/migrations/*/migration.sql; do psql "$DATABASE_URL" -f "$m" || break; done

# Seeder la bibliothèque de questions (obligatoire : sans elle, aucun
# trusted contact ne peut être créé — question_*_id est NOT NULL)
psql "$DATABASE_URL" -f prisma/seeds/001_checkin_questions.sql

# Vérifier
psql "$DATABASE_URL" -f prisma/tests/smoke.sql        # tout est rollbacké
psql "$DATABASE_URL" -f prisma/tests/seed_checks.sql  # lecture seule

# Régénérer le client typé
npx prisma db pull && npx prisma generate
```

22 tables, 89 index, 66 CHECK constraints, 1 FK différée, 23 lignes
`app_config` et 55 questions seedées.

## Backend

```bash
npm install
scripts/dev-services.sh start          # PostgreSQL 16 + Redis jetables, migrations + seed
cp apps/api/.env.example apps/api/.env # puis renseigner les secrets (openssl rand -hex 32)
npm run dev                            # http://localhost:3000/health
npm test                               # 343 tests d'intégration sur base réelle (anvil dans le PATH pour la chaîne)
npm run typecheck && npm run lint
```

Modules `auth`, `vault` et `transmission` — inscription par OTP, sessions,
step-up (DEC-25), clé publique et restauration Ed25519 (DEC-06),
réinitialisation, 2FA TOTP ; backup chiffré signé (DEC-07) sur stockage objet
(mémoire / fichiers / Storj) ; contacts de confiance scellés vers la clé de
Relais (DEC-28), parts Shamir signées (DEC-29), activation, pause,
vérification annuelle ; check-in mensuel par mini-jeu côté serveur, streak et
badges, relances J+7/14/21 et déclenchement par un job BullMQ quotidien
(`JOBS_ENABLED=true`) ; côté contact, liens de relay, escrow des parts
Shamir, déverrouillage à N réponses, purge à la confirmation ; carnet de vie
chiffré K2 à écritures signées et Wrapped annuel. Transmission, check-in,
relay et journal ont été écrits test-first ; back office `/admin/*` (auth
TOTP, utilisateurs, transmissions, questions, configuration, audit), écrit
test-first lui aussi, avec la facturation (encaissement manuel, grâce,
rétrogradation, export). Premier admin : `npm run admin:create -w apps/api`.
Détails et écarts dans [`docs/backend.md`](docs/backend.md).

## Contrat Arbitrum

```bash
git submodule update --init            # forge-std
cd contracts
forge test                             # 48 tests : machine à états, fuzz, invariants
forge test --gas-report
```

`RelaisDms.sol` est le chemin de secours : minuteur public que n'importe qui
peut déclencher après le silence, registre de la clé Ed25519 et des hachés
des parts, annuaire des CID des packs. L'opérateur écrit, l'owner signe,
tout le monde vérifie. Côté API (`CHAIN_ENABLED=true`), chaque action signée
part dans la file `chain_sync`, vidée chaque minute, et une réconciliation
quotidienne compare la chaîne à la base ; les tests tournent contre Anvil
(`anvil` dans le PATH, `forge build` dans `contracts/`). Design et décisions
dans [`docs/smart-contract-v2.md`](docs/smart-contract-v2.md).

## Principe non négociable

PostgreSQL ne contient que des métadonnées et des blobs opaques. Aucune clé,
aucun mot de passe utilisateur, aucune réponse aux questions secrètes, aucune
donnée du coffre en clair. Toute contribution qui ajoute une colonne lisible
contenant de la donnée utilisateur doit être justifiée explicitement.
