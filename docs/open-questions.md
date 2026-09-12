# RELAIS — Points ouverts dans les specs

Specs de référence (révision du 12 septembre 2026, commit `b5a81ab`) :
Schéma PostgreSQL **v1.5**, Backend Specs **v1.2**, Specs Techniques
**v1.3**, Frontend Specs **v1.2**, Back Office **v1.1**, User Stories
**v1.1**, Journal des Décisions **DEC-01 à DEC-35** (addendum v1.3,
inchangé), Dossier produit v1.0. Extraits markdown dans `docs/specs/`
(régénérés depuis les `.docx`). La revue de cette révision est en §F, celle
du contrat Arbitrum livré avec elle en §G et dans `docs/smart-contract.md`.

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
| Assignation d'un ticket à un collègue (BO-02) | **Fait le 12/09/2026** : `GET /admin/admins` (id, nom, rôle, statut — jamais d'email ; rôles support, admin, super_admin) et sélecteur d'assignation dans le détail du ticket. La gestion des comptes admin (création, suspension, reset TOTP) reste en ligne de commande. |
| Import CSV des questions (BO-04, super_admin) | Aucun endpoint dans l'API ; le back office (lot 2) n'offre que l'ajout unitaire. Reporté (décision du 12/09/2026, `docs/backoffice.md`) : `POST /admin/questions/import` si le besoin se confirme. |
| `billing.trial_days` (BO-05, défaut 0) | **Retirée le 12/09/2026** (migration `20260916000000`) : aucune règle ne disait ce qu'un essai débloque ni comment il finit, l'API ne la lisait pas, et une clé visible sans effet induit en erreur. À réintroduire avec une règle si le produit veut un essai. BO-05 §5.5 à corriger. |
| Parcours d'achat in-app (`subscription_upgraded` PostHog) | Aucun fournisseur de paiement ; encaissement manuel via `PUT /admin/billing/:id/plan`. |
| Alertes dashboard « Storj dégradé » et « espace Storj > 80 % » | **Dégradé : fait le 12/09/2026** — l'API compte ses propres erreurs de stockage (sorted set Redis, 15 min) et le tableau de bord lève `storage_degraded` (haute) à partir de 5. **Espace du bucket** : aucune API d'usage côté Storj ; alerte à configurer chez eux. |
| « Utilisateurs actifs 30 j » | Mesuré par `sessions.last_used_at`. `users.last_active_at` si une mesure exacte est voulue. |
| Notification au demandeur à la résolution d'un ticket, pièces jointes | **Notification : faite le 12/09/2026** — email `ticket_resolved` avec la note, au passage à « résolu » (migration `20260915000000`), `user_id` NULL pour un ticket sans compte. **Pièces jointes : non en V1 — tranché le 12/09/2026** (stockage et modération pour un besoin non démontré). |
| Notification à l'owner au déblocage d'un contact (BO-02) | **Tranché le 12/09/2026, élargi** : l'owner est prévenu au déclenchement, à la réponse réussie d'un contact, au blocage et au déblocage (`transmission_triggered`, `contact_answered`, `contact_blocked`, `contact_unblocked`, migration `20260914000000`), et annule lui-même par `POST /transmission/cancel` sous step-up. Backend §3.7 et §8, User Stories E5 à compléter. |
| Audit de sécurité interne (11/09/2026) | 15 constats sur `apps/api`. Corrigés : pause qui ne reprenait pas (lot 5) ; les trois HIGH (purge par un seul contact, annulation admin bloquante, limites de débit et force brute TOTP) ; les six MEDIUM (détournement d'une inscription en cours, oracles d'énumération, signature du vault liée à la catégorie et à l'horodatage, gardes de configuration en production, suppression RGPD des OTP et purge horaire, ouverture résiliente). Les LOW aussi (injection CSV, rôle < N porteurs, `POST /auth/keys` sous step-up `set_key` et atomique, `POST /vault/restore` lié au challenge Ed25519, TOTP à usage unique et secret chiffré par `TOTP_ENC_KEY`, attestation annuelle sur challenge serveur, codes d'erreur justes, URL brute hors logs, limiteur sur `POST /relay/:token/verify`). Les quinze constats sont traités. Choix documenté : le 423 du login reste (E1-US03). Techniques §5.2 et Backend §3.3 à mettre à jour pour le message signé du vault (`ts`). |
| Audit `TICKET_UPDATE` / cible `ticket` | Migration `20260430000000` ; repris par le Schéma v1.5. |
| Cœur crypto (11/09/2026) | Décisions dans `docs/crypto-core.md` §3 : Shamir maison GF(256) avec parts de **33 octets** (Techniques §1 et §4 disent « 32 bytes bruts » : à corriger), sel de K_i dérivé des `question_id`, Argon2id INTERACTIVE/MODERATE, normalisation des réponses, pas de `@noble/ed25519` (Frontend §1, §2.3), `libsodium-wrappers-sumo`. |
| E3-US03, E3-US07 (lot 4 mobile) | « Les réponses ne sont JAMAIS stockées » vaut pour le serveur ; sur le device elles restent chiffrées sous K2 (décision du 12/09/2026, `docs/mobile.md` §3), sinon toute modification après activation redemanderait les neuf réponses. E3-US07 « recréées automatiquement » se fait par désactiver → modifier → réactiver (contacts et schéma figés une fois actif). `secret_enc` porte aussi email et téléphone (Techniques §4.3, DEC-12 niveau 2 : à compléter). |
| E4-US04, E6-US04 (lot 5 mobile) | Le rappel à J-3 est un email `pause_ending` + un push ; la reprise en fin de pause est automatique (rien ne le disait), sans renouvellement. E4-US01 « validé par simple ouverture de l'app » n'est pas retenu côté app non plus. Les pushs ne sont pas tracés en base (fenêtres du jour du job) : Techniques et Backend à compléter (`docs/mobile.md` §3). |
| E5, E2-US07 (lot 6 mobile) | Le carnet est remis au porteur de K2 par `GET /relay/:token/data` et purgé avec le reste (Backend §3.7 et §6 à compléter). Techniques §5.2 « P2 = seal(Ki, P1) » : dans l'app, P2 scelle la liste des fiches chiffrées une à une ; `reconstruct` rend P2 ouvert et l'app déchiffre chaque fiche (à préciser). La progression « Fait » du contact vit sur son device sous le hachage du token, jamais côté serveur (E5-US04 « l'app garde la progression »). |
| E6-US03 (lot 2 mobile) | « Après changement : K1 K2 K3 sont recalculées, P1 rechiffré, P2 mis à jour » est obsolète depuis DEC-02/05 : les clés viennent du seed, pas du mot de passe. Rien n'est rechiffré. À corriger dans les User Stories. |
| Corrections de specs dues | Faites par la révision du 12/09 (annexes « Corrections » de chaque document) — les écarts qui restent sont en §F. Le seed `dms.relay_max_restarts` est ajouté (migration `20260913000000`). |
| Bibliothèque d'énigmes | 13 défis intégrés : assez pour tester, pas pour un an d'usage (§B.3). |
| `GET /journal/wrapped/:year/export` | L'API rend des métadonnées en GET et date l'export en POST ; la spec §6 ne garde que le POST. Cohérent. |

---

## F. Révision des specs du 12 septembre 2026 — ce qui reste à aligner

> Le texte à remplacer, document par document, est dans
> [`docs/specs/errata-2026-09.md`](specs/errata-2026-09.md) (12/09/2026) ; cette
> section se ferme quand les `.docx` l'ont intégré.

La révision reprend B.1 à B.7, D.1 à D.5 et la plupart des points de §E,
sous forme d'annexes « Corrections vX » ajoutées en fin de document. Vérifiée
contre l'API livrée le 12/09 (après les PR #20 à #22 de l'audit).

### F.1 Contrats décrits différemment de l'API

| Sujet | Spec (annexe) | API | À faire |
|---|---|---|---|
| Signature du vault (Backend §3, Frontend §4.2, Techniques §5.2) | `SHA256(category+ts+P2)`, `ts` en chaîne, rejet hors ± 5 min | `SHA256("relais:vault:v1\|" ‖ catégorie ‖ "\|" ‖ ts ‖ "\|" ‖ P2)`, `ts` **entier ms** dans le corps, fenêtre ± 5 min **et** strictement croissant par catégorie (409 `VAULT_SYNC_STALE`) — crypto-core `syncMessage` | Spec |
| 2FA (Backend §2.1) | login `{ temp_token, totp_code }`, activation `{ verified: true, recovery_codes }` | login `{ temp_token, code }` ou `{ temp_token, recovery_code }` ; activation `{ enabled: true, recovery_codes }` | Spec |
| Activation (Backend §4.3, Schéma v1.5) | `shares.kN = { enc, sig, plain_sig }`, colonnes `share_kN_plain_sig`, migration `20260912000000` | le client envoie aussi `plain_hash` (le serveur ne peut pas calculer SHA256(Si)) ; `plain_sig` vérifiée puis **non stockée** ; migration `20260911000000_v1_4_delta` (`20260912000000` est `lot5_pause_ending`) | Spec : retirer les colonnes `plain_sig` ou décider de les stocker |
| Check-in (Backend §5) | `POST /checkin/game/answer { game_token, answer_index }` | `{ game_token, answer }` (chaîne, 1 à 200 caractères) | Spec |
| Vérification annuelle (Backend §4.4, annexe B.2) | `POST /contacts/:id/verify { signature }` sur `SHA256(verify_token)` | audit LOW-15 : `GET /contacts/:id/verify-challenge` puis `POST { challenge_id, signature }` sur `SHA256(verify_token ‖ challenge)`, challenge à usage unique (5 min) | Spec |
| Clé publique (Backend §2.1, Frontend §3.1) | `POST /auth/keys` « une seule fois après OTP » | audit LOW-13 : step-up `set_key` obligatoire, écriture atomique | Spec |
| Restauration (Backend §3) | `POST /vault/restore` sur access token | audit LOW-13 : challenge Ed25519 vérifié dans les 15 min, sinon 403 `AUTH_RESTORE_REQUIRED` | Spec |
| Variables d'environnement (Backend §1) | — | `TOTP_ENC_KEY` (obligatoire), `TRUST_PROXY`, `PUSH_TRANSPORT`, `ONESIGNAL_*` | Spec |
| Back office (BO-01) | escrow expirant `< NOW() + 6h` | 12 h (`ESCROW_ALERT_HOURS`) | **Tranché le 12/09/2026 : 12 h** (le temps de voir l'alerte et d'étendre de +24/48 h). Spec |
| Back office (BO-03) | statut « Stalled » dans la liste | pas de statut : alerte `transmission_stalled` calculée (COUNT des `expired`) | Spec |
| `secret_enc` (Frontend §5.2) | champ `telephone` | crypto-core `SecretClear { nom, role, message_personnel, email?, phone? }` | Spec |
| Shamir (Techniques §1) | « 1 byte header GF256 » | le 33e octet est l'index de la part (abscisse) | Spec, wording |

### F.2 Livré par l'API et absent des specs techniques

- `POST /auth/push-token` · `DELETE /auth/push-token` (lot 5), transport
  push console / OneSignal, pushs à l'échéance, à la relance 1 et à J-3 de
  la fin de pause ; pushs non tracés en base.
- `GET /transmission/questions` (lot 4) ; `secret_enc` rendu à l'owner dans
  `GET /transmission/config`.
- Carnet dans `GET /relay/:token/data` pour le porteur de K2, purgé avec le
  reste (lot 6) — Backend §3.7 / §6.
- Email `pause_ending` et reprise automatique en fin de pause : dans les
  User Stories v1.1, pas dans Backend §8 ni Techniques.
- Job `maintenance:purge` (audit MEDIUM-9) ; codes `AUTH_FORBIDDEN`,
  `USER_ALREADY_DELETED`, `VAULT_SYNC_STALE`, `AUTH_RESTORE_REQUIRED` ;
  limiteur 10/min/IP sur `POST /relay/:token/verify` ; refus d'un rôle
  détenu par moins de N contacts à l'activation (LOW-12).
- P2 = enveloppe scellée d'une **liste de fiches chiffrées une à une**
  (Techniques §5.2 dit encore `seal(Ki, P1)`).

### F.3 Forme

Les anciens contrats restent dans le corps des documents à côté des
annexes : Backend (`storj_k1_path`, `verify_token_enc`, `answer_hash`,
`share_enc`, `SHA256(P1)`, `PUT /auth/register/keys`), Frontend
(`@noble/ed25519` et `PUT /auth/register/keys`, trois fois chacun),
Techniques (« 32 bytes bruts » deux fois, `answer_hash`). Un lecteur qui
s'arrête au corps repart avec le mauvais contrat : à intégrer dans le texte
à la prochaine édition.

---

## G. Contrat Arbitrum — revue de la proposition (12/09/2026)

Revue complète dans `docs/smart-contract.md`. Verdict : ne pas brancher en
l'état. **Design de la v2 écrit le 12/09/2026** (« Go, écris le design
Arbitrum v2 ») dans `docs/smart-contract-v2.md` : les cinq points du
tableau y sont tranchés (D1 à D5) ; les décisions encore ouvertes (pinning
IPFS, plancher du score d'autonomie, mode par défaut, publication de P2,
granularité des dates, garde de la clé opérateur) sont dans son §7.
Tableau conservé pour l'historique :

| Point | Constat | Décision attendue |
|---|---|---|
| Qui signe | Tout est clé sur `msg.sender` ; « appelé par le backend » ⇒ une seule config pour tous ; clé owner ⇒ pas de secp256k1 ni de gaz dans l'app, et le backend ne peut plus enregistrer le check-in | Owner, opérateur, ou EIP-712 relayé |
| Silence (DEC-35) | Compté depuis `lastCheckin` sans relances ; l'API compte depuis `next_checkin_due` après trois relances ; `markTriggered()` ne vérifie pas le silence | Aligner le contrat, ou changer DEC-35 |
| Pause | Reprise seulement par un `checkin()` : une pause suivie d'un décès bloque `isTriggered()` à jamais ; maximum figé à 90 j | Expiration de pause on-chain |
| Autonomie | Seule la clé owner peut `markTriggered()` ; un contact ne peut que lire ; les blobs et les liens restent chez Relais | `trigger(owner)` sans permission, puis pointeurs vers des blobs adressés par contenu |
| Métadonnées publiques | Check-ins, pauses (date de fin), déclenchement, N/M, `vaultPathHash` lié à `user_id` | Accepter, ou atténuer |
| Secondaire | Annulation admin impossible, `deactivate()` ne purge rien, `Completed` définitif, `schemaN = 1` accepté, DEC-10/11 partiels, `deploy.js` (`run` non importé) | v2 |

