# RELAIS — Schéma PostgreSQL : notes d'implémentation

**La spec fait foi** : `specs/Relais_Schema_PostgreSQL_v1.docx` (**v1.3**,
22 tables), complétée par l'Addendum Journal des Décisions v1.1 (DEC-20 à
DEC-27). Extraites en [`docs/specs/`](specs/).

Ce document ne redécrit pas le schéma — il consigne comment il est mis en
œuvre et ce qui a été vérifié.

| Artefact | Rôle |
|---|---|
| `prisma/migrations/20260410000000_init/` | Les 20 tables de la v1.1. **Source de vérité.** |
| `prisma/migrations/20260410000001_audit_writer_role/` | Trigger d'immuabilité + rôle `audit_writer` + REVOKE |
| `prisma/migrations/20260415000000_v1_2_dec20_dec27/` | Delta v1.1 → v1.2 |
| `prisma/migrations/20260420000000_v1_3_fix10_fix12/` | Delta v1.2 → v1.3 |
| `prisma/schema.prisma` | Miroir généré par `prisma db pull`. Ne pas éditer. |
| `prisma/seeds/001_checkin_questions.sql` | Bibliothèque de questions — 55 lignes, idempotent |
| `prisma/tests/smoke.sql` | Test de bout en bout, rollbacké |
| `prisma/tests/seed_checks.sql` | Contrôles de la bibliothèque, lecture seule |

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

Une instruction de la spec v1.2 n'a **pas** été appliquée, délibérément
(l'`UPDATE` sur `dms.durations_available`) ; la v1.3 l'a retirée (Fix-10).

---

## 2b. Ce que fait la migration v1.3

Un patch : la spec v1.3 intègre les six points relevés à la revue de code et
au seed.

| Fix | Effet en base |
|---|---|
| **Fix-11** | `checkin_questions` : `'shared_memory'` et `'other'` dans le CHECK, colonne `risk_notes` |
| **Fix-12a** | Index uniques partiels `idx_cq_text_fr` / `idx_cq_text_en` — `WHERE status != 'archived'`, pour qu'une reformulation puisse remplacer une question archivée au même libellé |
| **Fix-12b** | `payment_events` : `chk_amount_required` — montant obligatoire pour `created` / `renewed` |
| **Fix-12c** | `checkin_relances` : `email_log_id` FK `ON DELETE SET NULL`, `email_provider_id` et `delivery_status` retirés |
| **Fix-12d** | `app_config` : `security.pin_lockout_min` supprimée |
| Fix-10, Note-01 | Aucun effet en base |

Effet de bord voulu sur le seed : les cinq questions de mémoire partagée
rejoignent `shared_memory`, leur vraie catégorie. Les libellés du smoke test
sont préfixés `[smoke]` : ils ne peuvent plus heurter le seed maintenant que
`text_fr` est unique.

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
- **Trigger d'immuabilité et rôle `audit_writer`** — hors du modèle Prisma
  par nature.

Sens de circulation : SQL → base → `prisma db pull` → client typé. Éditer
`schema.prisma` à la main ferait diverger les deux silencieusement.

---

## 4. Vérifications passées

Cluster PostgreSQL 16 local, les quatre migrations appliquées à froid.

| Contrôle | Résultat |
|---|---|
| Les quatre migrations s'appliquent sans erreur | ✅ |
| Tables | **22** — conforme à l'en-tête v1.3 |
| Index | 89 |
| CHECK constraints | 66 |
| FK différées | 1 (`fk_cl_journal`) |
| Lignes `app_config` | 23 — `pin_lockout_min` retirée |
| `dms.durations_available` | `[1,3,6]` — intact |
| `checkin_relances` | plus aucune colonne de délivrance |

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
- `idx_cq_text_fr` rejette deux questions actives au même libellé, mais
  accepte qu'une archivée le partage avec sa remplaçante *(v1.3)*
- `chk_amount_required` rejette un `renewed` sans montant *(v1.3)*
- une relance lit son statut de délivrance via `email_log`, et survit à la
  purge du log avec `email_log_id` remis à NULL *(v1.3)*
- `security.pin_lockout_min` a disparu, `pin_backoff_steps` est là *(v1.3)*
- supprimer le user cascade sur toute la chaîne, `audit_logs` survit, et
  `email_log` survit avec `user_id` remis à NULL

**Immuabilité de `audit_logs`** — deux couches, testées séparément :

- un trigger `BEFORE UPDATE OR DELETE` qui lève `restrict_violation`, quel que
  soit le rôle. Vérifié **en superuser, sans qu'aucun rôle `app_user`
  n'existe** : `UPDATE` et `DELETE` refusés, la ligne survit. C'est la garantie
  de fond — elle ne dépend pas du nom que l'hébergeur donne au rôle applicatif ;
- le rôle `audit_writer` + `REVOKE` de la spec, en défense en profondeur.
  Vérifié avec un rôle `app_user` réel : `INSERT` passe, `UPDATE` et `DELETE`
  refusés.

**Les fichiers échouent bruyamment.** Migrations et tests commencent par
`\set ON_ERROR_STOP on` : un `psql -f` nu, tel que le README l'écrit, sort en
exit 3 au premier échec. Sans ça, un `ASSERT` raté abandonnait la transaction,
le `ROLLBACK` final réussissait, et psql sortait en 0 — une CI aurait vu vert.

**Les migrations sont atomiques.** Chacune est un bloc `BEGIN … COMMIT`.
Vérifié sur la v1.2 avec un contact déjà en base : l'`ADD COLUMN … NOT NULL`
échoue comme prévu, et **rien** de ce qui précède n'est commité — ni le
`DEFAULT 3`, ni `pin_backoff_steps`, ni `fk_cl_journal`, ni les deux nouvelles
tables. Après nettoyage, le même fichier se rejoue en exit 0. Sans le bloc, la
base restait à moitié migrée et le fichier mourait au rejeu sur
`email_log already exists`.

**Contrôles négatifs** : en retirant `chk_distinct_questions`,
`fk_cl_journal`, `idx_cq_text_fr`, `chk_amount_required` ou la colonne
`email_log_id`, la suite échoue bien (exit 3) au lieu de passer en silence.
`seed_checks` échoue aussi si la clé `vault.question_min_score` manque dans
`app_config` (`INTO STRICT`), au lieu de comparer à NULL et de passer par
défaut. Les assertions ont donc des dents.

**Suppression RGPD = anonymisation, pas `DELETE`.** Plusieurs FK vers `users`
sont en `NO ACTION` (`transmissions`, `payment_events`, `support_tickets`), donc
un `DELETE FROM users` échoue dès qu'un historique existe. C'est cohérent avec
la spec : `users` porte `deleted_at` / `deleted_by` / `deletion_reason`, et
BO-02 conserve « un log minimal : user_id anonymisé ». Le flux RGPD écrase les
PII en place et pose `deleted_at` ; il ne supprime pas la ligne. Le `DELETE`
du smoke test n'est qu'un test de cascade, pas le flux métier.

---

## 5. Seed de la bibliothèque de questions

`trusted_contacts.question_*_id` étant NOT NULL depuis DEC-20, **aucun trusted
contact ne peut exister tant que `checkin_questions` est vide**. Le seed est
donc une dépendance de démarrage, pas un confort.

`prisma/seeds/001_checkin_questions.sql` — 55 questions :

| Jeu | Volume | Détail |
|---|---|---|
| `secret_question` | 31 | Scores 6 à 10, 6 catégories dont `shared_memory`. Rien sous `vault.question_min_score`. |
| `journal` | 24 | Cycle annuel complet : 12 mois × 2 modes (`essential`, `reflective`) |

Idempotent : chaque ligne n'est insérée que si son `text_fr` est absent.
Rejouer le fichier ne fait rien ; y ajouter des questions et le rejouer
n'insère que les nouvelles.

Les questions secrètes suivent les critères BO-04 — réponse stable dans le
temps, connue du seul contact ciblé, univoque (un nom ou un mot), absente des
réseaux sociaux et des documents officiels. Les mieux notées sont les
questions de **mémoire partagée** entre l'owner et ce contact précis : seuls
eux deux connaissent la réponse, et elle ne vieillit pas.

Le vouvoiement des questions secrètes et le tutoiement des questions de carnet
sont voulus : les premières sont une vérification d'identité posée par la
plateforme, les secondes sont les mots de l'utilisateur pour ses proches.

`prisma/tests/seed_checks.sql` vérifie que la bibliothèque respecte les specs :
volume BO-04 (50-200), aucune question active sous le score minimum, les 12
mois couverts dans chaque mode, bilinguisme réel (`text_fr <> text_en`), pas de
libellé en double, pas de question secrète dans le cycle annuel ni l'inverse,
et qu'on peut bien composer 3 questions valides pour un contact.

---

## 6. À faire avant d'écrire l'API

- **Validation applicative** des questions rattachées à un contact
  (`usage_type` et score) — Note-01 de la spec v1.3, cf. open-questions §1.
- **Nom du rôle applicatif** : le `REVOKE` de la migration 2 suppose
  `app_user`. À aligner sur ce que crée l'hébergeur (Supabase ou Railway) —
  sans urgence, le trigger tient la garantie en attendant.
- **Flux RGPD** : anonymisation en place (voir §4), à implémenter comme telle
  dans `DELETE /admin/users/:id`.
- **Jobs de nettoyage** : quatre sont décrits en commentaire dans le DDL
  (`sessions` quotidien, `email_otp` / `restore_challenges` / `escrow_shares`
  horaires), plus la rétention 90 jours d'`email_log`. Ils appartiennent à
  BullMQ.
- **`_prisma_migrations`** : si l'équipe utilise `prisma migrate` plutôt que
  `psql`, faire `prisma migrate resolve --applied` sur les trois migrations
  pour poser la baseline.
