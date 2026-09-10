# RELAIS — Points ouverts dans les specs

État au regard des specs actuelles : Schéma PostgreSQL v1.1, Specs Techniques
v1.1, Journal des Décisions v1.0, Backend / Frontend / Back Office / User
Stories v1.0.

**Résolus par la v1.1**, retirés de cette liste : HCV Transit (DEC-16/17
tranché — P2 = XChaCha20(K, P1), HCV réduit à `relais_private_key`) et la
dérivation de K1/K2/K3 (Specs Techniques v1.1 §7 : « Le mot de passe n'a plus
de rôle dans la dérivation des clés »).

---

## 1. 🔴 Le contact ne peut pas lire ses propres questions

Specs Techniques v1.1 (§1 et §4.3) et le schéma v1.1 sont formels :

```
secret_enc = XChaCha20(K2, { nom, rôle, questions, message })
→ PostgreSQL. Relais ne peut pas lire.
```

Mais le flow post-mortem (§4.7) enchaîne :

```
Contact i clique le lien → ouvre l'app
→ Réponses aux questions secrètes saisies
```

**Le contact n'a aucune clé permettant d'ouvrir `secret_enc`.** Il ne possède
que ses réponses, et les réponses ne servent qu'à dériver `K_i`, qui ouvre
`Si_enc` — pas `secret_enc`. K2 appartient à l'owner, qui est mort.

Le flow ne dit jamais d'où viennent les questions affichées. Aujourd'hui,
elles ne peuvent venir de nulle part.

Trois sorties possibles :

1. **Les questions passent au niveau 1** — chiffrées avec `relais_public_key`
   et signées Ed25519, comme `notification_enc`. Relais peut les servir, ne
   peut pas les modifier sans invalider la signature. Coût : Relais voit le
   libellé des questions (pas les réponses).
2. **Les questions deviennent des références** vers `checkin_questions`, dont
   le texte est déjà public et administré. Cohérent avec BO-04 (« l'utilisateur
   choisit dans la bibliothèque, il ne peut pas en créer de toutes pièces ») et
   avec E3-US03 (« les questions sont stockées en clair en base »). Relais
   n'apprend rien : le texte vient de sa propre bibliothèque.
3. **Les questions sont dans l'email** envoyé au contact. Contredit
   frontalement « aucune donnée sensible dans l'email ».

L'option 2 semble la plus proche de l'intention d'ensemble, et
`trusted_contacts` n'aurait qu'à porter trois `question_id`. À trancher : **ça
bloque à la fois la table `trusted_contacts` et tout l'écran `/relay/:token`.**

---

## 2. 🔴 Aucune table pour le vault

Les Backend Specs §3.3 définissent une API vault complète :

```
GET/POST/PUT/DELETE  /vault/accounts
GET                  /vault/summary   → nb de comptes par catégorie
POST                 /vault/sync      → push P1 → P2 → Storj
GET                  /vault/sync-status
```

Le schéma v1.1 n'a **aucune** table correspondante. Ni items, ni état de sync.
Le seul pointeur est `transmission_configs.storj_vault_path`.

Deux lectures :

- **Le vault est purement local + blob Storj opaque.** C'est cohérent avec
  « le SQLite local est la source de vérité » et c'est plus zero-knowledge :
  le serveur ne sait même pas combien de comptes existent. Mais alors
  `/vault/accounts` et `/vault/summary` n'existent pas, et
  `vault.free_max_accounts = 5` **n'est pas applicable côté serveur** — la
  limite du plan gratuit ne serait qu'une politesse côté client.
- **Des tables manquent** au schéma.

Il faut trancher avant d'écrire le module vault de l'API. Si c'est la
première lecture, les Backend Specs §3.3 sont à réécrire.

---

## 3. 🟠 `silence_duration_months` : défaut 1 ou 3 ?

| Source | Défaut |
|---|---|
| Schéma v1.1, table 10 | `DEFAULT 1` |
| E3-US05 | « défaut : 3 mois » |
| Specs Techniques §7.3 | 3 mois — aligné sur la déconnexion pour inactivité |

Les Specs Techniques insistent sur cette cohérence : « 3 mois d'inactivité
déclenche simultanément la déconnexion et les premières relances ». Avec un
défaut à 1 mois, l'alignement saute.

J'ai gardé `DEFAULT 1` (fidélité au schéma). Une ligne à changer si c'est
bien 3.

---

## 4. 🟠 Le data recipient externe a disparu

E3-US04 : « Le data recipient peut être un trusted contact **ou une autre
personne (email uniquement)** ».

Le schéma v1.1 n'a pas de table `data_recipients`. La destination est déduite
de `has_k1_role` / `has_k2_role` / `has_k3_role` sur `trusted_contacts` — donc
le destinataire est **nécessairement** un trusted contact.

C'est probablement volontaire, et c'est plus cohérent : une personne sans
part Shamir ni compte n'a aucun moyen cryptographique de recevoir quoi que ce
soit sans que Relais voie le clair (ce qu'interdit DEC-14). Mais E3-US04 est
alors à corriger.

---

## 5. 🟠 Pas de journal d'envoi email, sauf pour les relances

BO-02, cas de support n°2 : « L'admin vérifie les logs d'envoi email (section
Monitoring > Logs email) » pour diagnostiquer un OTP non reçu.

Seule `checkin_relances` porte `email_provider_id` + `delivery_status`. Les
OTP, les notifications aux contacts et les emails d'abonnement n'ont aucune
traçabilité de délivrance. Le cas de support décrit dans BO-02 n'est pas
outillable en l'état.

Idem pour BO-07 : MRR, ARR et « revenus cumulés » ne sont pas calculables
depuis `subscriptions` seule, qui ne garde que l'état courant et pas
l'historique des paiements.

---

## 6. 🟡 Collision d'index dans le DDL de la spec

`idx_tc_status` est déclaré sur `transmission_configs` (table 10) **et** sur
`trusted_contacts` (table 11). PostgreSQL rejette le second.

Corrigé à l'implémentation en préfixant les index de `trusted_contacts` en
`idx_tcon_` — détail dans
[`docs/schema-postgresql.md`](schema-postgresql.md) §1. À reporter en v1.2.

---

## 7. 🟡 Trois versions du step-up token

Les Backend Specs contiennent la section 2.5 **trois fois**, avec des détails
divergents :

| | Endpoint | Header |
|---|---|---|
| §2.3 + §2.4 | `POST /auth/stepup` | `X-Stepup-Token` |
| §2.5 (2ᵉ) | `POST /auth/pin/step-up` | `X-StepUp-Token` |
| §2.5 (3ᵉ) | `POST /auth/pin/step-up` | `X-Step-Up-Token` |

§3.1 et les Frontend Specs §4.1 utilisent `POST /auth/pin/step-up` et
`X-Step-Up-Token` — version majoritaire, retenue sauf objection. Sans impact
sur le schéma : le `jti` vit en Redis.

Les listes d'actions divergent aussi : §2.4 omet `activate_transmission`,
`edit_recipients` et `disable_2fa`, présents dans le tableau de §2.5.

---

## 8. 🟡 Blocage PIN : 30 secondes ou 30 minutes ?

| Source | Valeur |
|---|---|
| E1-US03 | 30 **secondes** |
| Backend Specs §2.5, BO-05, `app_config` | 30 **minutes** |
| Frontend Specs §7.2 | 30 minutes |

Trois contre un pour 30 minutes, et c'est ce que porte `app_config`
(`security.pin_lockout_min = 30`). Reste que 30 minutes après 5 essais sur un
PIN à 6 chiffres, sur un device déjà déverrouillé par l'OS, est très punitif
pour un utilisateur légitime qui hésite — le vrai rempart contre le brute
force est Argon2id, pas le délai. Un backoff progressif (30 s, 2 min, 10 min,
30 min) satisferait les deux intentions. Valeur en `app_config`, donc
ajustable sans redéploiement.

---

## 9. 🟢 Détails mineurs

- **`checkin_log.journal_entry_id`** n'a pas de FK vers `journal_entries` — la
  table est créée après (ordre 12 vs 14). Une FK différée
  (`ALTER TABLE ... ADD CONSTRAINT`) en fin de migration la rétablirait sans
  casser l'ordre de création.
- **`GET /auth/seed-words`** ne peut pas retourner les 12 mots : le serveur ne
  les a jamais eus. L'endpoint autorise l'app à les réafficher depuis
  `seed_enc_pin`. Rien à stocker côté serveur, mais le nom induit en erreur.
- **Plan gratuit et schéma N-of-M** : `vault.free_max_contacts = 2` force le
  gratuit à exactement 2 contacts, donc à 2-of-2. Cohérent, mais l'UX doit
  l'expliquer plutôt que d'afficher un sélecteur de schéma inerte.
- **Fréquence de check-in** : E3-US05 propose « hebdomadaire / mensuel /
  bimestriel » ; le schéma contraint `checkin_frequency_weeks IN (1,2,4)`.
  « Bimestriel » (2 mois) ne correspond à aucune valeur — il s'agit
  probablement de *bimensuel* (2 semaines).
- **Persona Éric** apparaît dans le tableau récapitulatif du Dossier Produit
  §3 mais n'a pas de fiche. Sans impact technique.
