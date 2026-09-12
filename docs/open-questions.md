# RELAIS — Points ouverts dans les specs

Specs de référence (révision de septembre 2026, commit `32f4726`) : Schéma
PostgreSQL **v1.4** (23 tables), Backend Specs **v1.1** (réécrite, DEC-21 à
DEC-30 intégrés), Journal des Décisions **DEC-01 à DEC-35** (addendum v1.3),
Specs Techniques **v1.2** (§6 carnet / check-in), Frontend Specs **v1.1**,
Back Office / User Stories / Dossier produit v1.0. Extraits markdown dans
`docs/specs/`.

La révision de septembre reprend les points ouverts de ce document : cinq
sont tranchés (DEC-31 à DEC-35, Point-1, Point-2), trois sont consignés comme
**Proposals v1.5** (Proposal-8, 9, 11), et la réécriture des Backend Specs
introduit **sept écarts de contrat** avec l'API livrée, listés en §B. Le
fondateur a tranché le 11 septembre 2026 (« Go sur les 7 recommandations et
D1–D5 ») : §C est implémenté (lot « delta v1.4 »), §D consigne les
décisions. Reste, côté specs, à répercuter les corrections listées en §B.

---

## A. Points tranchés

### Par les specs v1.1 à v1.3 (première revue)

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

### Par la révision de septembre 2026 (Schéma v1.4, Décisions v1.3)

| Point ouvert (ancienne numérotation) | Décision | Implémenté |
|---|---|---|
| §1 — cinq types d'email manquants | **Point-1** — `account_locked`, `password_changed`, `restore_succeeded`, `two_factor_enabled`, `two_factor_disabled` entrent dans le CHECK v1.4. | ✅ migration `20260425000000`, identique à la spec |
| §5 — email de désignation sans type dédié | **Point-1** — type `contact_designated` (« désignation à l'activation »). Backend §4.3 étape 6 l'utilise. | ✅ migration `20260911000000`, gabarit FR/EN, prénom via la sealed box (§D.2) |
| §2 — codes de récupération 2FA | **Point-2** — table `two_factor_recovery_codes (user_id, code_hash CHAR(64), used_at)`, `UNIQUE (user_id, code_hash)`, 8 codes à l'activation, `DELETE` à la désactivation, `used_at` à l'usage. | ✅ migration + `POST /auth/2fa/verify` (§D.1) |
| §7 — qui fournit le mini-jeu, streak, relances | **DEC-33** (jeu fourni et vérifié serveur, jetons à usage unique), **DEC-34** (mois calendaires, 4 badges), **DEC-35** (J+7/14/21, déclenchement après 3 relances **et** silence écoulé, exemple : check-in du 1er janvier → déclenchement le 1er avril). | ✅ API — un écart sur la source des énigmes (§B.3) |
| §10 — carnet signé, seuil du Wrapped | **DEC-31** (POST/PUT signent `SHA256(content_enc)`, DELETE signe `SHA256(uuid)`, Wrapped signe `SHA256(stats_enc)`), **DEC-32** (COUNT serveur, 409 `WRAPPED_INSUFFICIENT_ENTRIES { current, required: 6 }`). | ✅ API, contrat identique |
| §4 — activation sans Arbitrum | Backend v1.1 §5 et §8 marquent Arbitrum « [si contrat branché] » ; l'API sans contrat est conforme. | ✅ rien à faire (contrat reporté) |
| Vault : signature sur P1 ou P2 ? | Frontend v1.1 §4.2 signe `sha256(P2)` — le blob envoyé, comme l'API. Backend §3 dit encore « SHA256(P1) » dans le body et « P2 equivalent » dans la vérification : coquille à corriger dans la spec. | ✅ API |
| §13 — alerte « HCV indisponible » | Backend v1.1 §1 et §9.1 réintroduisent HCV en production pour `relais/x25519_sk` uniquement (DEC-15/17/30). | ✅ `/health` sonde `sys/health`, alerte `service_down` (§C.4) |

Errata User Stories actés par l'addendum, toujours à répercuter dans le
document : E3-US04 (recipient externe), E1-US03 (blocage PIN), E3-US05
(« bimestriel » → *bimensuel*).

---

## B. Écarts de contrat entre Backend Specs v1.1 et l'API livrée

La réécriture des Backend Specs décrit sept contrats différents de ceux
implémentés (et testés) dans `apps/api`. Pour chacun : ce que dit la spec,
ce que fait l'API, et la recommandation. Les décisions sont regroupées en
§D.

### B.1 `POST /transmission/activate` — parts envoyées ou chemins Storj

Spec §4.3 : le client envoie `storj_kN_path`, `share_kN_hash`,
`share_kN_sig` et `verify_token` par contact, le serveur vérifie les
signatures sur les hashes reçus. API : le client envoie les octets
(`shares.kN.{enc, sig}`), le serveur choisit le chemin, calcule le hash
lui-même et vérifie la signature sur **ce** hash (`docs/backend.md` §3). Un
hash fourni par le client ne prouve rien sur ce qui est réellement stocké ;
le chemin choisi par le client permettrait de pointer sur un objet
arbitraire. **Décision : API conservée, spec §4.3 à amender** (et à
compléter par `plain_hash` / `plain_sig`, §D.3).

### B.2 `POST /transmission/verify-contact/:id { verify_token_enc }`

Spec §4.4 : le serveur répond `{ verified: true | false }` à partir de
`verify_token_enc`. Il n'a aucun moyen d'évaluer ce champ sans K_i, qu'il
ne doit jamais voir (DEC-13). API : `POST /transmission/contacts/:id/verify
{ signature = Ed25519.sign(SHA256(verify_token)) }` — l'app vérifie
localement, le serveur date une attestation signée par l'owner. Même
garantie que DEC-07/29/31. **Décision : API conservée ; la spec §4.4 adopte
le corps signé et le chemin `/contacts/:id/verify`.**

### B.3 Check-in : source des énigmes et forme du `game_token`

Spec §5 / DEC-33 : « sélectionne énigme `checkin_questions` », `game_token`
JWT `{ question_id, answer_hash, exp 10 min }` signé `JWT_CHECKIN_SECRET`,
Redis pour l'usage unique. Deux problèmes : `checkin_questions` est la
bibliothèque des **questions secrètes** (texte, catégorie, fiabilité) — elle
n'a ni réponse ni `answer_hash` dans le schéma v1.4 ; et un `answer_hash`
dans un JWT lisible par le client permet de forcer la réponse hors ligne
(SHA256 d'une réponse courte). API : bibliothèque intégrée
(`api/checkin/games.ts`), état de partie en Redis 24 h, réponse jamais
transmise au client, jeton opaque. Le reste (`checkin_token` 15 min à usage
unique, `POST /complete { checkin_token, journal_entry_id? }`) est
identique. **Décision : API conservée ; DEC-33 à corriger (bibliothèque
serveur, jeton opaque). Une table `checkin_games` administrable reste
possible en v1.5.**

### B.4 `POST /relay/:token/verify` — `{ share_enc }` ou `{ shares }`

Spec §7 : body `{ share_enc: Si re-chiffré « clé session Redis » }`,
réponse `{ accepted, shares_remaining }`. La « clé session » n'est définie
nulle part (aucun endpoint ne la remet au contact) et un seul champ ne
couvre pas un contact qui détient plusieurs rôles. API : `{ failed: true }`
ou `{ shares: { k1?, k2?, k3? } }` (parts pour chaque rôle détenu, scellées
côté serveur avec la clé éphémère `escrow:key:{transmission}`), réponse
avec l'état du déverrouillage. Les tentatives (5 → blocage 24 h) sont
comptées sur déclaration de l'app puisque la vérification est locale
(E5-US02). **Décision : API conservée ; spec §7 et E5-US02 à amender.**

### B.5 `GET /journal/entries/month/:ym` — absent de l'API

Spec §6 ajoute une lecture par mois (`:ym` = `YYYY-MM`). Non implémenté :
`GET /journal/entries` liste tout. **Décision : ajouté** — `:ym` au format
`YYYY-MM`, contenu inclus, 404 si le mois est vide, 400 si le format est
mauvais.

### B.6 Clé privée : `RELAIS_X25519_SK_DEV` + HCV en production

Spec §1 et §9.1 : `RELAIS_X25519_SK_DEV` hors production, `hcv.getSecret('relais/x25519_sk')`
avec `HCV_ADDR` / `HCV_TOKEN` en production. API : variable `RELAIS_X25519_SK`
lue par `services/secrets` quel que soit l'environnement, HCV non branché.
**Décision : suivi** — `RELAIS_X25519_SK_DEV` hors production (interdite en
production), HCV KV v2 obligatoire en production (`HCV_ADDR`, `HCV_TOKEN`,
`HCV_SECRET_PATH` = `secret/data/relais/x25519_sk`, `HCV_SECRET_FIELD`),
aucun repli, `/health` sonde `sys/health`.

### B.7 Enregistrement de la clé publique : `PUT /auth/register/keys`

Frontend v1.1 §3.1 appelle `PUT /auth/register/keys { ed25519_pk }` ;
Backend §2.1 ne liste aucun endpoint pour cela. API : `POST /auth/keys`
(une seule fois, après vérification OTP — `docs/backend.md` §3).
**Décision : `POST /auth/keys` conservé ; Frontend §3.1 à corriger.**

Contrats confirmés identiques par la révision : `notification_sig` signe
`notification_enc` brut (Backend §4.3 étape 2, Frontend §5.1) ; `share_kN_sig`
signe `SHA256(Si_enc)` ; carnet et Wrapped (§6) ; dead man's switch (§8) ;
`POST /checkin/complete` ; `GET /relay/:token` (l'API renvoie un sur-ensemble :
`verify_token` et les Si_enc du contact en plus des questions et rôles).

---

## C. Implémenté — lot « delta v1.4 » (11 septembre 2026)

Migration `20260911000000_v1_4_delta`, tests écrits avant le code
(`docs/backend.md` §5) :

1. **`contact_designated`** — type ajouté, gabarit FR/EN « rien à faire
   pour l'instant », envoyé par `POST /transmission/activate` avec le prénom
   pris dans la sealed box (§D.2). `transmission_contact` reste l'email de
   déclenchement et de relance admin.
2. **`two_factor_recovery_codes`** — 8 codes rendus par
   `POST /auth/2fa/verify` à l'activation, `recovery_code` accepté au login
   à la place du TOTP, usage unique, purgés à la désactivation et à la
   suppression RGPD (§D.1).
3. **`GET /journal/entries/month/:ym`** (§B.5).
4. **HCV** — `services/secrets` lit KV v2 quand `HCV_ADDR` est configuré,
   obligatoire en production ; `RELAIS_X25519_SK_DEV` ailleurs ; sonde dans
   `/health`, donc alerte `service_down` du dashboard (§B.6).
5. **Proposal-8** — `plain_hash` + `plain_sig` par part à l'activation,
   colonnes `share_kN_plain_hash`, comparaison à `POST /relay/:token/verify`
   (422 `RELAY_SHARE_INVALID`, compté comme un échec) (§D.3).
6. **Proposal-9** — type `contact_progress` envoyé aux autres contacts au
   blocage et à une confirmation intermédiaire ; `relay:cleanup` ne relance
   plus après `dms.relay_max_restarts` (3) expirations et le dashboard
   remonte `transmission_stalled` (§D.4).

---

## D. Tranché le 11 septembre 2026 (« Go sur les 7 recommandations et D1–D5 »)

### D.1 Codes de récupération : par quel endpoint ?

Backend v1.1 §2.1 ne prévoit aucun endpoint. **Décision** : les 8 codes sont
rendus par `POST /auth/2fa/verify` au moment où la 2FA passe à `enabled`
(une seule fois) ; le second temps du login, `POST /auth/2fa/verify
{ temp_token, recovery_code }`, accepte un code de secours à la place du
TOTP ; pas de regénération en V1 (désactiver puis réactiver la 2FA). Email
`two_factor_disabled` inchangé. À ajouter à la spec §2.1.

### D.2 Prénom de l'owner dans l'email de désignation

Le serveur ne connaît pas le nom de l'owner. Soit l'email reste anonyme
(« un utilisateur de Relais vous a désigné »), soit l'app ajoute
`owner_display_name` dans `notification_enc` (lisible par Relais, comme
l'email du contact — même niveau de confidentialité, DEC-12). **Décision** :
la seconde — `notification_enc = crypto_box_seal({ email, phone,
owner_display_name? })`, 60 caractères max. À porter dans Techniques §4.3
et Frontend §5.1.

### D.3 Proposal-8 — hash de la part en clair

`share_kN_plain_hash = SHA256(Si)` signé Ed25519 à l'activation ;
`POST /relay/:token/verify` compare avant escrow, une part fausse compte
comme un échec. 32 bytes par part, aucune information sur Si (Si a 32 bytes
d'entropie). Sans elle, une part fausse ne se voit qu'au déchiffrement
final, escrow consommé. **Décision : adoptée** — Backend §4.3 (corps de
l'activation) et §7 (`RELAY_SHARE_INVALID`), Schéma `trusted_contacts` à
mettre à jour.

### D.4 Proposal-9 — `contact_progress` et plafond de redémarrage

Type `email_log` pour prévenir l'autre contact (blocage E5-US02,
confirmation E5-US03) ; plafond de 3 expirations d'escrow puis alerte admin
(BO-03) au lieu du redémarrage sans fin actuel. **Décision : adoptées** —
le plafond est le COUNT des lignes `transmissions` en `expired` pour la
config (pas de colonne), `dms.relay_max_restarts` lu dans `app_config`
avec repli à 3 (ligne à ajouter au seed v1.5), alerte `transmission_stalled`
(BO-01).

### D.5 Proposal-11 — logs API

Table `api_logs` PostgreSQL (BO-06 `GET /admin/logs/api`, alerte « erreur
API > seuil ») ou export Pino vers Loki / Datadog. Recommandation : export
externe ; retirer `GET /admin/logs/api` de BO-06 et l'alerte associée, ou
les brancher sur l'outil choisi. Une table de logs d'appels grossirait plus
vite que toutes les autres réunies et ne doit rien contenir de personnel
(CLAUDE.md). **Décision : export externe** — `GET /admin/logs/api` et
l'alerte « erreur API > seuil » sortent de BO-06 / BO-01 ; l'outil (Loki,
Datadog…) se choisit au déploiement.

### D.6 Écarts §B.1 à B.7 — API ou spec ?

**Décision** : API conservée pour B.1, B.2, B.3, B.4, B.7 (les specs se
corrigent, voir chaque écart en §B) ; spec suivie pour B.5 et B.6, faits.

---

## E. Points toujours ouverts, sans réponse dans la révision

| Point | État |
|---|---|
| `billing.trial_days` (BO-05, défaut 0) | Aucune règle ne dit ce qu'un essai débloque ni comment il finit. Sans effet dans l'API. |
| Parcours d'achat in-app (`subscription_upgraded` PostHog) | Aucun fournisseur de paiement ; encaissement manuel via `PUT /admin/billing/:id/plan`. |
| Alertes dashboard « Storj dégradé » et « espace Storj > 80 % » | Aucun compteur d'erreurs ni API d'usage du bucket. Non calculées. |
| « Utilisateurs actifs 30 j » | Mesuré par `sessions.last_used_at`. `users.last_active_at` si une mesure exacte est voulue. |
| Notification au demandeur à la résolution d'un ticket, pièces jointes | Aucun type `email_log`, aucun stockage. Non faits. |
| Notification à l'owner au déblocage d'un contact (BO-02) | Aucun type `email_log`. Non envoyée. |
| Audit `TICKET_UPDATE` / cible `ticket` | Migration `20260430000000` ; toujours absent de la liste des actions auditées du schéma v1.4. |
| Cœur crypto (11/09/2026) | Décisions dans `docs/crypto-core.md` §3 : Shamir maison GF(256) avec parts de **33 octets** (Techniques §1 et §4 disent « 32 bytes bruts » : à corriger), sel de K_i dérivé des `question_id`, Argon2id INTERACTIVE/MODERATE, normalisation des réponses, pas de `@noble/ed25519` (Frontend §1, §2.3), `libsodium-wrappers-sumo`. |
| E3-US03, E3-US07 (lot 4 mobile) | « Les réponses ne sont JAMAIS stockées » vaut pour le serveur ; sur le device elles restent chiffrées sous K2 (décision du 12/09/2026, `docs/mobile.md` §3), sinon toute modification après activation redemanderait les neuf réponses. E3-US07 « recréées automatiquement » se fait par désactiver → modifier → réactiver (contacts et schéma figés une fois actif). `secret_enc` porte aussi email et téléphone (Techniques §4.3, DEC-12 niveau 2 : à compléter). |
| E6-US03 (lot 2 mobile) | « Après changement : K1 K2 K3 sont recalculées, P1 rechiffré, P2 mis à jour » est obsolète depuis DEC-02/05 : les clés viennent du seed, pas du mot de passe. Rien n'est rechiffré. À corriger dans les User Stories. |
| Corrections de specs dues | B.1 à B.4 et B.7 (Backend §4.3, §4.4, §5, §7 ; Frontend §3.1), D.1 (Backend §2.1), D.2 (Techniques §4.3, Frontend §5.1), D.3 et D.4 (Schéma `trusted_contacts`, `email_log`, seed `dms.relay_max_restarts`), D.5 (BO-06, BO-01). |
| Bibliothèque d'énigmes | 13 défis intégrés : assez pour tester, pas pour un an d'usage (§B.3). |
| `GET /journal/wrapped/:year/export` | L'API rend des métadonnées en GET et date l'export en POST ; la spec §6 ne garde que le POST. Cohérent. |
