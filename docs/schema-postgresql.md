# RELAIS — Schéma PostgreSQL : notes d'implémentation

**La spec fait foi** : `specs/Relais_Schema_PostgreSQL_v1.docx` (**v1.2**,
22 tables), complétée par l'Addendum Journal des Décisions v1.1 (DEC-20 à
DEC-27). Extraites en [`docs/specs/`](specs/).

Ce document ne redécrit pas le schéma — il consigne comment il est mis en
œuvre et ce qui a été vérifié.

| Artefact | Rôle |
|---|---|
| `prisma/migrations/20260410000000_init/` | Les 20 tables de la v1.1. **Source de vérité.** |
| `prisma/migrations/20260410000001_audit_writer_role/` | Rôle `audit_writer` + REVOKE |
| `prisma/migrations/20260415000000_v1_2_dec20_dec27/` | Delta v1.1 → v1.2 |
| `prisma/schema.prisma` | Miroir généré par `prisma db pull`. Ne pas éditer. |
| `prisma/tests/smoke.sql` | Test de bout en bout, rollbacké |

---

## 1. Pourquoi un delta plutôt qu'un `init` réécrit

La v1.2 aurait pu être repliée dans la migration initiale — rien n'est encore
déployé. Elle est gardée séparée pour deux raisons :

- les migrations 1 et 2 sont déjà poussées et relues ; les réécrire ferait
  diverger l'historique de ce qui a été validé ;
- le delta **exécute** les décisions DEC-20 à DEC-27, ce qui rend la
  traçabilité spec → code lisible dans `git log` plutôt que noyée dans un
  gros fichier.

Une fois la première release taguée, la règle habituelle s'applique : les
migrations sont append-only.

---

## 2. Ce que fait la migration v1.2

| Décision | Effet en base |
|---|---|
| **DEC-20** | `trusted_contacts` gagne `question_1/2/3_id` NOT NULL → `checkin_questions`, `chk_distinct_questions`, et 3 index |
| **DEC-22** | `silence_duration_months` passe à `DEFAULT 3` |
| **DEC-24** | Tables `email_log` (21) et `payment_events` (22) |
| **DEC-26** | `app_config` : `security.pin_backoff_steps = [30,120,600,1800]` |
| **Fix-09a** | FK `fk_cl_journal` `DEFERRABLE INITIALLY DEFERRED` |
| DEC-21, 23, 25, 27 | Aucun effet en base (vault local, recipient interne, step-up en Redis, renommage d'endpoint) |
| Fix-06 | Déjà appliqué dans la migration 1 |

Les colonnes `question_*_id` sont **NOT NULL sans valeur par défaut** : la
migration échoue bruyamment si des contacts existent déjà, plutôt que de leur
inventer des questions. C'est le comportement voulu — il n'existe pas de
question par défaut acceptable pour un mécanisme d'identité.

Une instruction de la spec n'est **pas** appliquée, délibérément : voir
[`docs/open-questions.md`](open-questions.md) §1.

---

## 3. Pourquoi le SQL est la source de vérité, pas Prisma

La spec est écrite en DDL et s'appuie sur quatre choses que Prisma ne sait pas
exprimer :

- **66 CHECK constraints** — Prisma les signale à l'introspection et les
  ignore. Écrites côté Prisma, elles disparaîtraient au premier `migrate`.
- **Index partiels** (`WHERE status = 'active'`, `WHERE deleted_at IS NULL`…)
  — pas de syntaxe Prisma. Ce sont eux qui rendent le job DMS quotidien
  efficace : `idx_tc_checkin` ne porte que sur les transmissions actives.
- **FK différée** `fk_cl_journal` — `DEFERRABLE` n'existe pas dans le modèle
  Prisma. Sans elle, insérer un check-in avant son entrée de journal dans la
  même transaction échouerait.
- **Rôle `audit_writer` + REVOKE** — hors du modèle Prisma par nature.

Sens de circulation : SQL → base → `prisma db pull` → client typé. Éditer
`schema.prisma` à la main ferait diverger les deux silencieusement.

---

## 4. Vérifications passées

Cluster PostgreSQL 16 local, les trois migrations appliquées à froid.

| Contrôle | Résultat |
|---|---|
| Les trois migrations s'appliquent sans erreur | ✅ |
| Tables | **22** — conforme à l'en-tête v1.2 |
| Index | 86 |
| CHECK constraints | 66 |
| FK différées | 1 (`fk_cl_journal`) |
| Lignes `app_config` | 24 |
| `dms.durations_available` | `[1,3,6]` — intact |

`prisma/tests/smoke.sql` construit une chaîne complète — admin → questions →
user → config → 2 contacts (dont un cumulant K1+K2, chacun avec 3 questions
distinctes) → check-in → journal → DMS → relay tokens → escrow → abonnement →
événements de paiement — puis vérifie :

- `chk_roles` rejette un contact sans aucun rôle
- `chk_distinct_questions` rejette deux questions identiques *(v1.2)*
- `schema_m >= schema_n` rejette N > M
- `idx_cl_user_month` rejette deux check-ins le même mois
- `idx_es_contact_category` rejette deux parts de même catégorie par contact
- le CHECK email rejette une adresse malformée
- `amount_fcfa > 0` rejette un paiement à zéro *(v1.2)*
- `silence_duration_months` vaut bien 3 par défaut *(v1.2)*
- la FK différée accepte un check-in inséré **avant** son entrée de journal,
  et rejette quand même un `journal_entry_id` inexistant en fin de
  transaction *(v1.2)*
- le calcul MRR de BO-07 tourne sur `payment_events` *(v1.2)*
- supprimer le user cascade sur toute la chaîne, `audit_logs` survit, et
  `email_log` survit avec `user_id` remis à NULL

**Immuabilité de `audit_logs` testée pour de vrai** avec un rôle `app_user`
réel : `INSERT` passe, `UPDATE` et `DELETE` sont refusés par PostgreSQL.

**Contrôles négatifs** : en retirant `chk_distinct_questions` puis
`fk_cl_journal`, la suite échoue bien (exit 3) au lieu de passer en silence.
Les assertions ont donc des dents.

---

## 5. À faire avant d'écrire l'API

- **Seed des données de référence** : `checkin_questions` est vide, et c'est
  désormais bloquant — `trusted_contacts.question_*_id` est NOT NULL, donc
  **aucun contact ne peut être créé tant que la bibliothèque est vide**. Il
  faut deux jeux : questions secrètes scorées (BO-04, seuil ≥ 6) et questions
  de carnet de vie sur cycle annuel (`cycle_month` 1-12).
- **Validation applicative** des questions rattachées à un contact
  (`usage_type` et score) — non exprimable en CHECK, cf. open-questions §2.
- **Nom du rôle applicatif** : la migration 2 suppose `app_user`. À aligner
  sur ce que crée l'hébergeur (Supabase ou Railway).
- **Jobs de nettoyage** : quatre sont décrits en commentaire dans le DDL
  (`sessions` quotidien, `email_otp` / `restore_challenges` / `escrow_shares`
  horaires), plus la rétention 90 jours d'`email_log`. Ils appartiennent à
  BullMQ.
- **`_prisma_migrations`** : si l'équipe utilise `prisma migrate` plutôt que
  `psql`, faire `prisma migrate resolve --applied` sur les trois migrations
  pour poser la baseline.
