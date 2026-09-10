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
| Schéma PostgreSQL | 🟡 Proposition à valider (`prisma/`, `docs/schema-postgresql.md`) |
| API backend | ⬜ Non démarré |
| App mobile | ⬜ Non démarré |
| Back office | ⬜ Non démarré |
| Smart contract Arbitrum | ⬜ Reporté |

## Documentation

- [`docs/schema-postgresql.md`](docs/schema-postgresql.md) — le schéma, ses
  décisions de modélisation, ce qui reste à modéliser
- [`docs/open-questions.md`](docs/open-questions.md) — contradictions relevées
  entre les specs, à trancher avant d'implémenter
- [`docs/specs/`](docs/specs/) — les 8 documents de spec convertis en markdown
  (sources `.docx` dans `specs/`)

## Schéma

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/relais"
npx prisma validate      # vérifier le schéma
npx prisma migrate dev   # appliquer sur une base locale
npx prisma studio        # explorer
```

Le DDL complet est versionné dans
`prisma/migrations/00000000000000_init/migration.sql`.

## Principe non négociable

PostgreSQL ne contient que des métadonnées et des blobs opaques. Aucune clé,
aucun mot de passe utilisateur, aucune réponse aux questions secrètes, aucune
donnée du coffre en clair. Toute contribution qui ajoute une colonne lisible
contenant de la donnée utilisateur doit être justifiée explicitement.
