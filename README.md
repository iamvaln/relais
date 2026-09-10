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
| Schéma PostgreSQL v1.1 | ✅ Implémenté et testé (`prisma/`) |
| API backend | ⬜ Non démarré |
| App mobile | ⬜ Non démarré |
| Back office | ⬜ Non démarré |
| Smart contract Arbitrum | ⬜ Reporté |

## Documentation

- [`docs/schema-postgresql.md`](docs/schema-postgresql.md) — notes
  d'implémentation du schéma : l'écart trouvé dans la spec, les vérifications
  passées, ce qui reste à faire
- [`docs/open-questions.md`](docs/open-questions.md) — contradictions relevées
  entre les specs, à trancher avant d'implémenter
- [`docs/specs/`](docs/specs/) — les 8 documents de spec convertis en markdown
  (sources `.docx` dans `specs/`)

## Schéma

La spec `specs/Relais_Schema_PostgreSQL_v1.docx` (v1.1) fait foi. Elle est
implémentée en SQL — **le DDL est la source de vérité**, parce que les CHECK
constraints, les index partiels et le rôle `audit_writer` ne sont pas
exprimables en Prisma. `schema.prisma` en est un miroir généré, à ne pas
éditer à la main.

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/relais"

# Appliquer (dans cet ordre)
psql "$DATABASE_URL" -f prisma/migrations/20260410000000_init/migration.sql
psql "$DATABASE_URL" -f prisma/migrations/20260410000001_audit_writer_role/migration.sql

# Vérifier
psql "$DATABASE_URL" -f prisma/tests/smoke.sql   # tout est rollbacké

# Régénérer le client typé
npx prisma db pull && npx prisma generate
```

20 tables, 76 index, 60 CHECK constraints, 23 lignes `app_config` seedées.

## Principe non négociable

PostgreSQL ne contient que des métadonnées et des blobs opaques. Aucune clé,
aucun mot de passe utilisateur, aucune réponse aux questions secrètes, aucune
donnée du coffre en clair. Toute contribution qui ajoute une colonne lisible
contenant de la donnée utilisateur doit être justifiée explicitement.
