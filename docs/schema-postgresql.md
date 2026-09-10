# RELAIS — Schéma PostgreSQL : notes d'implémentation

**La spec fait foi** : `specs/Relais_Schema_PostgreSQL_v1.docx` (v1.1),
extraite en [`docs/specs/Relais_Schema_PostgreSQL_v1.md`](specs/Relais_Schema_PostgreSQL_v1.md).

Ce document ne redécrit pas le schéma — il consigne ce qui s'est passé en le
mettant en œuvre : l'écart trouvé, les choix d'outillage, et ce qui reste à
faire.

| Artefact | Rôle |
|---|---|
| `prisma/migrations/20260410000000_init/` | Les 20 tables. **Source de vérité.** |
| `prisma/migrations/20260410000001_audit_writer_role/` | Rôle `audit_writer` + REVOKE |
| `prisma/schema.prisma` | Miroir généré par `prisma db pull`. Ne pas éditer. |
| `prisma/tests/smoke.sql` | Test de bout en bout, rollbacké |

---

## 1. Écart relevé dans la spec : collision d'index

`idx_tc_status` est déclaré **deux fois** — sur `transmission_configs`
(table 10) et sur `trusted_contacts` (table 11), les deux abrégeant en `tc`.
PostgreSQL refuse : les noms d'index sont uniques par schéma.

```
ERROR: relation "idx_tc_status" already exists
```

Les trois index de `trusted_contacts` sont donc préfixés `idx_tcon_` :

| Spec v1.1 | Implémenté |
|---|---|
| `idx_tc_transmission` | `idx_tcon_transmission` |
| `idx_tc_user` | `idx_tcon_user` |
| `idx_tc_status` | `idx_tcon_status` |

`transmission_configs` garde `idx_tc_status` et `idx_tc_checkin` inchangés.
À reporter dans la spec en v1.2.

---

## 2. Pourquoi le SQL est la source de vérité, pas Prisma

La spec est écrite en DDL, et elle s'appuie sur trois choses que Prisma ne
sait pas exprimer :

- **60 CHECK constraints** — Prisma les signale à l'introspection et les
  ignore. Écrites en Prisma, elles disparaîtraient au premier `migrate`.
- **Index partiels** (`WHERE status = 'active'`, `WHERE deleted_at IS NULL`…)
  — pas de syntaxe Prisma. Ce sont eux qui rendent le job DMS quotidien
  efficace : `idx_tc_checkin` ne porte que sur les transmissions actives.
- **Rôle `audit_writer` + REVOKE** — hors du modèle Prisma par nature.

D'où le sens de circulation : SQL → base → `prisma db pull` → client typé.
Éditer `schema.prisma` à la main ferait diverger silencieusement les deux.

---

## 3. Vérifications passées

Cluster PostgreSQL 16 local, migrations appliquées à froid.

| Contrôle | Résultat |
|---|---|
| Les deux migrations s'appliquent sans erreur | ✅ |
| Tables créées | 20 — exactement la liste de la spec |
| Index | 76 |
| CHECK constraints | 60 |
| Lignes `app_config` seedées | 23 |

`prisma/tests/smoke.sql` construit ensuite une chaîne complète — admin →
user → config → 2 contacts (dont un cumulant K1+K2) → check-in → entrée de
journal → déclenchement DMS → relay tokens → escrow — puis vérifie :

- `chk_roles` rejette un contact sans aucun rôle
- `schema_m >= schema_n` rejette N > M
- `idx_cl_user_month` rejette deux check-ins le même mois
- `idx_es_contact_category` rejette deux parts de même catégorie par contact
- le CHECK email rejette une adresse malformée
- supprimer le user cascade sur toute la chaîne, **et `audit_logs` survit**

**Immuabilité de `audit_logs` testée pour de vrai** avec un rôle `app_user`
réel : `INSERT` passe, `UPDATE` et `DELETE` sont refusés par PostgreSQL.

```
INSERT 0 1
ERROR:  permission denied for table audit_logs   (UPDATE)
ERROR:  permission denied for table audit_logs   (DELETE)
```

---

## 4. À faire avant d'écrire l'API

- **Seed des données de référence** : `checkin_questions` est vide. Il en
  faut deux jeux — questions secrètes scorées (BO-04, seuil ≥ 6) et questions
  du carnet de vie sur cycle annuel (`cycle_month` 1-12).
- **Nom du rôle applicatif** : la migration 2 suppose `app_user`. À aligner
  sur ce que crée réellement l'hébergeur (Supabase ou Railway).
- **Jobs de nettoyage** : quatre sont décrits en commentaire dans le DDL
  (`sessions` quotidien, `email_otp` / `restore_challenges` / `escrow_shares`
  horaires). Ils appartiennent à BullMQ, pas au schéma.
- **`_prisma_migrations`** : si l'équipe utilise `prisma migrate` plutôt que
  `psql`, il faudra `prisma migrate resolve --applied` sur les deux
  migrations pour marquer la baseline.

Points ouverts sur la spec elle-même :
[`docs/open-questions.md`](open-questions.md).
