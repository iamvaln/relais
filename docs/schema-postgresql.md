# RELAIS — Schéma PostgreSQL

**Version 1.0 — proposition à valider**
Source de vérité : [`prisma/schema.prisma`](../prisma/schema.prisma)
DDL généré : [`prisma/migrations/00000000000000_init/migration.sql`](../prisma/migrations/00000000000000_init/migration.sql)

Dérivé de : Specs Techniques v1, Backend Specs v1, Journal des Décisions v1,
Back Office Specs v1, User Stories v1, Flowcharts v1.

37 tables, 20 enums.

---

## 1. Principe directeur

Le schéma est construit autour d'une règle unique : **PostgreSQL ne contient
que des métadonnées et des blobs opaques.** Toute colonne suffixée `Enc` est
un ciphertext produit sur le device ; le backend la stocke et la restitue
sans jamais la déchiffrer.

Une seule exception, explicitement documentée : `TrustedContact.notificationEnc`,
chiffré avec `relais_public_key`, que le backend déchiffre avec
`relais_private_key` (HCV Secrets Engine, DEC-15) dans le seul but d'envoyer
un email. C'est le « facteur aveugle » de DEC-14.

### Ce qui n'est jamais en base

| Donnée | Où elle vit |
|---|---|
| Seed BIP39 / 12 mots | Device uniquement (`seed_enc_pin` dans SecureStore) |
| K1, K2, K3, K_login | Mémoire vive uniquement |
| PIN et ses dérivés | SecureStore device — ne transite jamais (DEC-02) |
| Réponses aux questions secrètes | **Nulle part.** Servent uniquement à dériver K_i |
| Données D en clair | Mémoire vive uniquement |
| Access token | Stateless, jamais persisté |

---

## 2. Cartographie des modules

| # | Module | Tables |
|---|---|---|
| 1 | Utilisateur & auth | `users`, `sessions`, `two_factors`, `two_factor_recovery_codes`, `email_otps`, `password_resets`, `restore_challenges` |
| 2 | Vault | `vault_syncs`, `vault_items` |
| 3 | Transmission — config | `transmission_configs`, `trusted_contacts`, `trusted_contact_questions`, `trusted_contact_shares`, `data_recipients` |
| 4 | Check-in & DMS | `checkin_states`, `checkin_records`, `checkin_games`, `reminders` |
| 5 | Carnet de vie | `journal_questions`, `journal_entries`, `wrappeds` |
| 6 | Transmission — post-mortem | `transmission_runs`, `transmission_category_states`, `relay_tokens`, `escrow_shares`, `relay_task_progress`, `transmission_logs` |
| 7 | Questions secrètes | `secret_questions` |
| 8 | Back office | `admin_users`, `admin_sessions`, `audit_logs`, `app_config`, `support_tickets` |
| 9 | Facturation | `subscriptions`, `payments` |
| 10 | Observabilité | `email_logs`, `system_alerts` |

---

## 3. Décisions de modélisation

Les points ci-dessous ne découlent pas mécaniquement des specs — ce sont des
choix que j'ai faits et qu'il faut valider.

### 3.1 `TransmissionConfig` ≠ `TransmissionRun`

Les specs parlent de « transmission » pour deux choses différentes : la
configuration permanente (contacts, schéma, délais) et l'événement de
déclenchement. Je les ai séparées.

`TransmissionRun` fige une photographie du schéma (`threshold`,
`totalShares`) au moment du déclenchement : la config peut être modifiée
ensuite sans corrompre un run en cours. Cela rend aussi possible plusieurs
runs successifs (un déclenchement annulé parce que l'owner est revenu, puis
un vrai plus tard) sans écraser l'historique.

### 3.2 Avancement par catégorie — `TransmissionCategoryState`

Specs Techniques §4.7-4.8 : chaque `Kj` est reconstituée indépendamment, et
le nettoyage se fait « catégorie par catégorie ». Une seule colonne de statut
sur le run ne suffit donc pas. `TransmissionCategoryState` porte
`sharesCollected`, `unlockedAt` et `purgedAt` par catégorie.

Conséquence pratique : `ACCOUNTS` peut être déverrouillée et purgée pendant
que `FINANCES` attend encore sa Nᵉ part.

### 3.3 Les questions secrètes sont des références, pas du texte

DEC-12 place `questions` dans `secret_enc` (niveau 2, illisible par Relais).
Mais T6 exige que l'app **affiche les 3 questions au contact**, qui ne
possède aucune clé permettant de lire `secret_enc`. Les deux sont
incompatibles.

BO-04 tranche : « L'utilisateur peut personnaliser les questions parmi la
bibliothèque proposée, mais ne peut pas en créer de toutes pièces. »
Le texte des questions est donc **public et administré**.

D'où le modèle : `trusted_contact_questions` ne stocke que
`(contactId, questionId, position)` — des références vers `secret_questions`.
Relais peut les servir au contact ; il n'apprend rien de secret au passage,
puisque le texte vient de sa propre bibliothèque. Les **réponses** restent
introuvables, ce qui est la seule chose qui compte.

`secret_enc` conserve alors son rôle : nom du contact, message personnel,
notes — le vrai niveau 2.

⚠️ Ce point contredit littéralement DEC-12 et mérite validation. Voir
[`docs/open-questions.md`](open-questions.md) §1.

### 3.4 `position` sert d'index de part Shamir

`TrustedContact.position` est unique par utilisateur et sert d'index de part.
Il ne doit jamais être réattribué : supprimer le contact en position 2 puis
en ajouter un nouveau ne doit pas recréer une position 2 tant que des parts
de l'ancien existent, sinon la reconstitution Shamir mélange deux découpages.

### 3.5 `VaultItem` ne stocke pas le nom du service

Le SQLite local garde `service_name` en clair (Frontend Specs §6.2) — c'est
acceptable, la base est chiffrée par SQLCipher. Côté serveur ça ne l'est
pas : une liste de noms de services est déjà un profil exploitable. Le
serveur ne détient donc que `contentEnc`, `category` et `urgency`.

`urgency` reste en clair côté serveur volontairement : elle sert au tri de la
checklist du contact en post-mortem (E5-US04) et ne révèle rien d'exploitable
sur ce que contient l'item.

### 3.6 Le PIN n'existe pas dans ce schéma

Aucune table ne le mentionne, ce qui est le comportement attendu (DEC-02,
Backend Specs §2.4). Les compteurs d'échecs PIN sont **locaux au device** ;
les compteurs mot de passe / OTP / step-up `jti` vivent en Redis. Aucun état
de blocage n'est persisté en PostgreSQL, sauf `TrustedContact.blockedUntil`
— celui-là doit survivre à un flush Redis, puisqu'il porte sur une fenêtre
de 24h dans un processus post-mortem.

### 3.7 `audit_logs` doit être verrouillé en base

Le modèle Prisma ne peut pas exprimer l'immuabilité. À faire dans une
migration manuelle :

```sql
REVOKE UPDATE, DELETE ON audit_logs FROM relais_app;
REVOKE UPDATE, DELETE ON transmission_logs FROM relais_app;
```

Sans ça, « log immuable » (Backend Specs §1.2) n'est qu'une intention.

### 3.8 `transmission_logs.userRef` est un hash

La preuve légale doit survivre à une suppression RGPD du compte. La table ne
porte donc pas de FK vers `users` mais un hash du `user_id`, et aucun contenu.

---

## 4. Colonnes prévues pour la blockchain (non branchées)

Conformément à la décision de garder Arbitrum pour plus tard, les colonnes
existent mais ne sont alimentées par rien :

| Colonne | Destination on-chain (DEC-10) |
|---|---|
| `users.ed25519PublicKey` | Identité publique Arbitrum |
| `vault_syncs.payloadHash` / `payloadSignature` | Preuve d'intégrité (DEC-07) |
| `checkin_states.lastCheckinAt` | `lastCheckin[owner]` du smart contract |
| `transmission_configs.threshold` / `silenceDurationMonths` | `config[owner]` du smart contract |

Le hash de P2 n'est délibérément **pas** modélisé pour publication on-chain :
DEC-10 le proscrit (historique comportemental public exploitable).

---

## 5. Point ouvert : HCV Transit

`vault_syncs.hcvKeyVersion` est nullable et le schéma fonctionne dans les
deux hypothèses :

- **DEC-16/17 appliqué** — P2 = XChaCha20(K, P1), la colonne reste `NULL`.
- **Specs Techniques §4.4 appliqué** — P1 → HCV Transit → P2, la colonne
  porte la version de clé ayant produit le blob (indispensable pour
  déchiffrer après une rotation de clé HCV).

Aucune autre table n'est affectée. La décision peut donc rester en suspens
sans bloquer les migrations.

---

## 6. Valeurs par défaut et `app_config`

Les défauts codés dans le schéma (`threshold = 2`, `silenceDurationMonths = 3`,
`checkinFrequencyWeeks = 4`, `currency = XAF`…) correspondent aux valeurs
BO-05. Les seuils opérationnels — `escrow_ttl_hours`, `pin_max_attempts`,
`free_max_accounts`, `premium_price_fcfa`… — ne sont **pas** en dur dans le
schéma : ils vivent dans `app_config`, modifiables par le Super Admin sans
redéploiement, avec traçabilité avant/après dans `audit_logs`.

Un seed de `app_config` reprenant les 30 paramètres de BO-05 §5.1 à §5.5
reste à écrire.

---

## 7. Ce qui n'est pas encore modélisé

- **Seed de données** : bibliothèque de questions secrètes (BO-04),
  questions du carnet de vie, énigmes de check-in, valeurs `app_config`.
- **Notifications push** : `expo-notifications` implique de stocker un push
  token par device. À rattacher à `sessions` ou à une table `devices`.
- **Capsule temps** : hors scope V1 (Dossier Produit §2.5) mais `K2` et
  `journal_entries` la couvrent structurellement.
- **Smart contract Arbitrum** : reporté.
