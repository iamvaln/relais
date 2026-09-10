# RELAIS — Points ouverts dans les specs

Specs de référence : Schéma PostgreSQL **v1.3**, Specs Techniques v1.2,
Backend Specs v1.1, Addendum Journal des Décisions v1.1 (DEC-20 à DEC-27),
Back Office / User Stories / Frontend v1.0.

**Il ne reste aucun point ouvert bloquant.** Les huit constats de la première
revue ont été tranchés par DEC-20 à DEC-27 ; les quatre durcissements proposés
à la revue de code et les deux écarts BO-04 ont été intégrés par le Schéma
v1.3 (Fix-10 à Fix-12d, Note-01). Ce document garde la trace de ce qui a été
décidé, et un seul rappel : la validation qui vit dans l'API, pas en base.

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
| `UPDATE` incorrect sur `dms.durations_available` | **Fix-10** — retiré de la spec. Jamais appliqué. | ✅ rien à faire |
| BO-04 : catégorie « Autres » et champ « Risques » absents | **Fix-11** — `'shared_memory'` + `'other'` dans le CHECK, colonne `risk_notes`. | ✅ migration 4 |
| Pas d'`UNIQUE` sur `checkin_questions.text_fr` | **Fix-12a** — index uniques partiels `idx_cq_text_fr` / `idx_cq_text_en` (`WHERE status != 'archived'`). | ✅ migration 4 |
| `amount_fcfa` nullable sans lien avec `event_type` | **Fix-12b** — `chk_amount_required`. | ✅ migration 4 |
| Double source de vérité `email_log` / `checkin_relances` | **Fix-12c** — `checkin_relances.email_log_id` FK, colonnes de délivrance retirées. | ✅ migration 4 |
| Ligne morte `security.pin_lockout_min` | **Fix-12d** — supprimée. | ✅ migration 4 |
| Validation `usage_type` + score non exprimable en CHECK | **Note-01** — dans le handler `POST/PUT /transmission/contacts` ; trigger acceptable en alternative. | ⏳ API |

Errata User Stories actés par l'addendum, à répercuter dans le document :
E3-US04 (recipient externe), E1-US03 (blocage PIN), E3-US05 (« bimestriel »
→ *bimensuel*).

---

## 1. 🟢 Contrainte non exprimable en SQL, à porter dans l'API (Note-01)

Le Schéma v1.3 (Note-01) le note lui-même pour `trusted_contacts` : « uniquement des
questions de type `secret_question` ou `both` — vérifié en application, pas de
CHECK sur sous-select en PG standard ».

Rien n'empêche donc, au niveau base, de rattacher à un contact une question de
carnet de vie (`usage_type = 'journal'`), ou une question sous le seuil
`vault.question_min_score = 6`. À valider dans le handler
`POST/PUT /transmission/contacts`.

Note-01 donne le handler de référence (`validateContactQuestions`) et admet
un trigger `BEFORE INSERT OR UPDATE` en alternative si l'équipe préfère la
ceinture et les bretelles — à arbitrer quand l'API sera écrite.
