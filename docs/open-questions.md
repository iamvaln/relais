# RELAIS — Points ouverts dans les specs

Specs de référence : Schéma PostgreSQL **v1.3**, Specs Techniques v1.2,
Backend Specs v1.1, Addendum Journal des Décisions v1.1 (DEC-20 à DEC-27),
patch DEC-28 à DEC-30 (avril 2026), Back Office / User Stories / Frontend v1.0.

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
| Validation `usage_type` + score non exprimable en CHECK | **Note-01** — dans le handler `POST/PUT /transmission/contacts` ; trigger acceptable en alternative. | ✅ API (`validateQuestions`, testé) |
| Chiffrement de `notification_enc` | **DEC-28** — `crypto_box_seal` vers la clé X25519 de Relais, `GET /transmission/relais-key` public. | ✅ API |
| Intégrité des parts Shamir | **DEC-29** — chaque Si_enc signée Ed25519 sur son SHA256, toutes vérifiées à l'activation. | ✅ API |
| Qui lit la clé privée, qui envoie l'email | **DEC-30** — `services/secrets`, email envoyé dans le handler, tracé dans `email_log`. | ✅ API (HCV à brancher en prod) |

Errata User Stories actés par l'addendum, à répercuter dans le document :
E3-US04 (recipient externe), E1-US03 (blocage PIN), E3-US05 (« bimestriel »
→ *bimensuel*).

---

## 1. 🟡 `email_log.email_type` ne couvre pas les notifications des user stories

Le CHECK v1.3 liste 11 types. Cinq emails exigés ailleurs n'y figurent pas :

| Email | Exigé par |
|---|---|
| Compte verrouillé après 5 échecs | Backend Specs §2.5 — « Email de notification » |
| Mot de passe changé | E6-US03 |
| Coffre restauré sur un nouvel appareil | E6-US01 |
| 2FA activée | E6-US02 |
| 2FA désactivée | E6-US02 |

Sans eux, l'API devait soit ne pas envoyer ces emails, soit les envoyer sans
les tracer — ce que DEC-24 interdit. **Comblé par la migration
`20260425000000_email_types_notifications`** (`account_locked`,
`password_changed`, `restore_succeeded`, `two_factor_enabled`,
`two_factor_disabled`). À reporter dans la spec v1.4.

---

## 2. 🟡 Codes de récupération 2FA : aucune table

E6-US02 : « Des codes de récupération d'urgence sont générés et affichés une
fois. » Le schéma n'a ni table ni colonne pour les stocker (hashés, à usage
unique). Le TOTP est implémenté sans eux : perdre son authenticateur signifie
passer par le support (BO-02, déblocage manuel).

Proposition v1.4 : table `two_factor_recovery_codes (id, user_id, code_hash
CHAR(64), used_at, created_at)` avec `UNIQUE (user_id, code_hash)`, 8 codes
générés à l'activation, consommés par `POST /auth/2fa/verify` en lieu et
place du code TOTP.

---

## 3. ✅ Contrainte non exprimable en SQL, portée dans l'API (Note-01)

Fait : `validateQuestions` dans `api/transmission/service.ts`, appliqué à
`POST /contacts`, `PUT /contacts/:id` et `POST /activate` — existence,
unicité, statut actif, `usage_type ≠ journal`, score ≥
`vault.question_min_score` (lu dans `app_config`, défaut 6). Le trigger
« ceinture et bretelles » reste possible ; non ajouté.

---

## 4. 🟡 Activation : pas d'enregistrement Arbitrum

Backend §3.4 étape 5 : `contract.register()` pousse les hashes des parts
on-chain. Aucun service blockchain dans ce lot (smart contract « reporté »
au README). Les hashes sont calculés et stockés (`share_kN_hash`),
`contract_registered` reste `false`. À brancher quand le contrat existera —
idéalement comme un job idempotent qui relit les hashes en base, plutôt que
dans le handler.

---

## 5. 🟡 Email de désignation des contacts : pas de type dédié

DEC-30 prévient chaque contact à l'activation. `email_log.email_type` n'a
qu'un type contact, `transmission_contact`, dont le texte parle de
déclenchement. Il est réutilisé avec `link = FRONTEND_URL/contact`. Proposition
v1.4 : type `contact_designated` avec un texte « X vous a désigné comme
contact de confiance — rien à faire pour l'instant », et décider si l'owner
peut joindre un prénom (aujourd'hui le serveur n'en a aucun).

---

## 6. 🟢 Deux écarts de contrat sur `POST /transmission/activate`

Consignés dans `docs/backend.md` §3 : le client envoie les octets des parts
(`shares.kN.{enc, sig}`) et non `storj_kN_path` + `share_kN_hash` ; les
champs reprennent la forme de `POST /contacts` (`roles`, `question_ids`,
`schema`). À répercuter dans la spec v1.4 si l'équipe les adopte.

---

## 7. 🟢 Check-in : trois choix que la spec laisse ouverts

Tranchés avec le fondateur, consignés dans `docs/backend.md` §3 :

| Point | Décision |
|---|---|
| Qui fournit le mini-jeu et vérifie la réponse | Le serveur (bibliothèque intégrée, jeton à usage unique). « Validé par simple ouverture de l'app » (E4-US01) non retenu côté API. |
| Ce que compte le streak | Mois calendaires consécutifs ; badges `first_checkin`, `streak_3`, `streak_6`, `streak_12`. |
| Relances et déclenchement | Relances à J+7/14/21 (`dms.relance_intervals_days`) ; déclenchement après les trois relances **et** `silence_duration_months` écoulé — le pseudo-code §4.2 (« relance 3 + 21 j ») rendait ce paramètre inopérant. |

À répercuter dans la spec v1.4. Reste à écrire : `deadman:trigger` (module
relay) et un texte d'énigmes plus fourni — la bibliothèque compte 13 défis,
suffisant pour tester, pas pour un an d'usage.

---

## 8. 🟡 Relay : une part déposée n'est pas vérifiable par le serveur

Les réponses restent sur le device (E5-US02) : l'app dépose les parts Si
déchiffrées. Le serveur n'a aucun moyen de savoir qu'une part est
authentique — une part fausse (bug, contact malveillant) ne se voit qu'au
déchiffrement final, quand l'escrow est déjà consommé.

Proposition v1.4 : à l'activation, l'app envoie aussi `SHA256(Si)` par rôle
(colonne `share_kN_plain_hash` ou table dédiée), signé comme le reste
(DEC-29). `POST /relay/:token/verify` compare avant de mettre en escrow ;
une part fausse compte comme un échec. Coût : 32 bytes par part, aucune
information sur Si.

---

## 9. 🟢 Relay : deux choix tranchés, deux manques de la spec

| Point | Décision |
|---|---|
| Tentatives | L'app déclare ses échecs (`{ failed: true }`) ; le serveur tient le compteur (5 → 24 h). |
| Fin de transmission | Quand chaque contact ayant répondu a confirmé, ou 30 jours après l'escrow (E5-US04). |
| Email de déclenchement | Sans message personnel (dans `secret_enc`, illisible côté serveur) — E5-US01 à amender. |
| Notification à l'autre contact (blocage, E5-US02 ; confirmation, E5-US03) | Aucun type `email_log` ne la couvre : non envoyée. Proposer `contact_progress` en v1.4. |

Le redémarrage après escrow expiré (E5-US03) est implémenté sans plafond :
à chaque expiration, nouveaux liens et nouveaux emails. Un maximum (3 ?)
puis une alerte admin (BO-03) serait raisonnable.
