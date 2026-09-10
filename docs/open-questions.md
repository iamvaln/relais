# RELAIS — Points ouverts dans les specs

Specs de référence : Schéma PostgreSQL **v1.2**, Specs Techniques **v1.2**,
Backend Specs **v1.1**, Addendum Journal des Décisions **v1.1** (DEC-20 à
DEC-27), Back Office / User Stories / Frontend v1.0.

**Les huit points ouverts de la revue précédente sont tranchés.** Ce document
ne garde que ce qui reste en suspens — un seul item, mineur.

---

## Points tranchés

| Point | Décision | Implémenté |
|---|---|---|
| Le contact ne peut pas lire ses questions | **DEC-20** — 3 FK vers `checkin_questions`, texte public. Retirées de `secret_enc`. | ✅ migration 3 |
| Aucune table pour le vault | **DEC-21** — volontaire. Vault purement local + blob Storj. `/vault/accounts` et `/vault/summary` supprimés. `free_max_accounts` devient une contrainte molle côté client. | ✅ rien à faire |
| `silence_duration_months` : 1 ou 3 ? | **DEC-22** — `DEFAULT 3`, aligné sur `session_months`. | ✅ migration 3 |
| Data recipient externe | **DEC-23** — supprimé. Le destinataire est toujours un trusted contact avec rôle. E3-US04 à corriger. | ✅ rien à faire |
| Pas de journal email ni d'historique de paiement | **DEC-24** — tables `email_log` et `payment_events`. | ✅ migration 3 |
| Trois versions du step-up token | **DEC-25** — `POST /auth/pin/step-up` + `X-Step-Up-Token`, 8 actions. | ✅ Redis, hors schéma |
| Blocage PIN : 30 s ou 30 min ? | **DEC-26** — backoff progressif `[30, 120, 600, 1800]` s, 100 % côté client. | ✅ `app_config` |
| `GET /auth/seed-words` trompeur | **DEC-27** — `POST /auth/seed/display`, retourne `{ authorized: true }`. | ✅ rien à faire |
| Collision `idx_tc_status` | **Fix-06** — index `trusted_contacts` préfixés `idx_tcon_`. | ✅ migration 1 |
| FK manquante `checkin_log` → `journal_entries` | **Fix-09a** — FK `DEFERRABLE INITIALLY DEFERRED`. | ✅ migration 3 |

Errata User Stories actés par l'addendum, à répercuter dans le document :
E3-US04 (recipient externe), E1-US03 (blocage PIN), E3-US05 (« bimestriel »
→ *bimensuel*).

---

## 1. 🟡 Un `UPDATE` de la spec v1.2 casserait `dms.durations_available`

Le §2 du Schéma v1.2 contient :

```sql
-- Mise à jour valeur par défaut silence DMS (DEC-22)
UPDATE app_config SET value = '3' WHERE key = 'dms.durations_available'; -- reste [1,3,6]
```

L'instruction contredit son propre commentaire. `dms.durations_available` est
de `config_type = 'array_int'` et vaut `[1,3,6]` — la liste des durées
proposées dans l'UI. L'écraser par le scalaire `'3'` ne changerait pas un
défaut, ça **retirerait les options 1 mois et 6 mois du sélecteur** et
laisserait une valeur qui n'est plus un tableau.

DEC-22 porte sur `transmission_configs.silence_duration_months`, une colonne,
pas sur cette clé de configuration. Le `DEFAULT 3` de la colonne suffit.

**Non appliqué dans la migration**, avec un commentaire à cet endroit du DDL.
La ligne est à retirer de la spec en v1.3.

*Détail au passage : la note dit « 3 correspond au 3ème mois dans
`durations_available` ». Dans `[1,3,6]`, la valeur 3 est le 2ème élément.*

---

## 2. 🟡 Deux champs de BO-04 absents du schéma `checkin_questions`

BO-04 « Structure d'une question » décrit deux éléments que le DDL ne porte
pas :

| BO-04 | État |
|---|---|
| Catégorie **Autres** | Absente du `CHECK (category IN (...))` |
| **Risques** — « notes sur les risques identifiés (usage interne) » | Aucune colonne |

La catégorie manquante s'est vue à l'usage : les meilleures questions
secrètes sont celles de **mémoire partagée** (« Quel surnom donnez-vous à
cette personne, que personne d'autre n'utilise ? » — score 10), qui ne
relèvent d'aucune des cinq catégories restantes. Elles sont pour l'instant
rangées dans `people` / `events` / `habits` / `places` selon la nature de la
réponse attendue, ce qui fonctionne mais brouille le filtre par catégorie du
back office.

Deux options : rajouter `'other'` (et éventuellement `'shared_memory'`, plus
parlant) au CHECK, ou acter que BO-04 se réduit à cinq catégories. La colonne
`risk_notes` est à ajouter si le back office doit vraiment l'éditer.

Sans effet sur le fonctionnement — d'où le 🟡 et non le 🔴.

---

## 3. 🟡 Quatre durcissements du DDL à proposer en v1.3

Relevés à la revue de code du schéma. Aucun n'empêche le fonctionnement ;
tous ferment une porte que le DDL v1.2 laisse ouverte. Non appliqués ici
parce qu'ils modifient la spec elle-même — à trancher pour la v1.3.

| # | Table | Constat | Proposition |
|---|---|---|---|
| a | `checkin_questions` | Aucun `UNIQUE` sur `text_fr` / `text_en`. Un admin peut créer deux questions au libellé identique ; un owner les rattache toutes deux au même contact, `chk_distinct_questions` passe (ids différents), le contact n'a en réalité que deux questions. | `UNIQUE (text_fr)`, `UNIQUE (text_en)` |
| b | `payment_events` | `amount_fcfa` est nullable sans lien avec `event_type`. Un `renewed` sans montant est accepté et disparaît silencieusement du MRR (`SUM` ignore les NULL). | `CHECK (event_type NOT IN ('created','renewed') OR amount_fcfa IS NOT NULL)` |
| c | `email_log` / `checkin_relances` | Les deux tables tracent la délivrance des mêmes emails de relance (`provider_id`/`status` d'un côté, `email_provider_id`/`delivery_status` de l'autre). Un webhook Resend doit mettre les deux à jour ; celui qu'on oublie affiche `sent` quand l'autre dit `bounced`. | Faire pointer `checkin_relances` vers `email_log(id)` et retirer ses deux colonnes de délivrance |
| d | `app_config` | `security.pin_lockout_min` subsiste alors que DEC-26 le remplace par `pin_backoff_steps`. BO-05 l'affiche comme éditable : un admin le modifie, rien ne se passe. | Supprimer la ligne |

Le point (a) est le plus important : il rend contournable la seule contrainte
qui garantit que trois questions sont bien trois questions.

---

## 4. 🟢 Contrainte non exprimable en SQL, à porter dans l'API

Le Schéma v1.2 le note lui-même pour `trusted_contacts` : « uniquement des
questions de type `secret_question` ou `both` — vérifié en application, pas de
CHECK sur sous-select en PG standard ».

Rien n'empêche donc, au niveau base, de rattacher à un contact une question de
carnet de vie (`usage_type = 'journal'`), ou une question sous le seuil
`vault.question_min_score = 6`. À valider dans le handler
`POST/PUT /transmission/contacts`.

Un trigger `BEFORE INSERT OR UPDATE` le ferait respecter en base si l'équipe
préfère la ceinture et les bretelles — à arbitrer quand l'API sera écrite.
