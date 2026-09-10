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
| Schéma PostgreSQL v1.3 | ✅ Implémenté et testé (`prisma/`) |
| API backend — auth, vault, transmission | ✅ 32 endpoints, 85 tests d'intégration (`apps/api/`) |
| API backend — check-in, journal, relay, admin, jobs | ⬜ À faire |
| App mobile | ⬜ Non démarré |
| Back office | ⬜ Non démarré |
| Smart contract Arbitrum | ⬜ Reporté |

## Documentation

- [`docs/backend.md`](docs/backend.md) — notes d'implémentation de l'API :
  décisions, écarts par rapport aux specs, vérifications
- [`docs/schema-postgresql.md`](docs/schema-postgresql.md) — notes
  d'implémentation du schéma : l'écart trouvé dans la spec, les vérifications
  passées, ce qui reste à faire
- [`docs/open-questions.md`](docs/open-questions.md) — contradictions relevées
  entre les specs, à trancher avant d'implémenter
- [`docs/specs/`](docs/specs/) — les 8 documents de spec convertis en markdown
  (sources `.docx` dans `specs/`)

## Schéma

La spec `specs/Relais_Schema_PostgreSQL_v1.docx` (v1.3) fait foi. Elle est
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
npm test                               # 85 tests d'intégration sur base réelle
npm run typecheck && npm run lint
```

Modules `auth`, `vault` et `transmission` — inscription par OTP, sessions,
step-up (DEC-25), clé publique et restauration Ed25519 (DEC-06),
réinitialisation, 2FA TOTP ; backup chiffré signé (DEC-07) sur stockage objet
(mémoire / fichiers / Storj) ; contacts de confiance scellés vers la clé de
Relais (DEC-28), parts Shamir signées (DEC-29), activation, pause,
vérification annuelle. Le module transmission a été écrit test-first.
Détails et écarts dans [`docs/backend.md`](docs/backend.md).

## Principe non négociable

PostgreSQL ne contient que des métadonnées et des blobs opaques. Aucune clé,
aucun mot de passe utilisateur, aucune réponse aux questions secrètes, aucune
donnée du coffre en clair. Toute contribution qui ajoute une colonne lisible
contenant de la donnée utilisateur doit être justifiée explicitement.
