# RELAIS — Contradictions et points ouverts dans les specs v1

Relevés en lisant les 8 documents de `docs/specs/` pour construire le schéma
PostgreSQL. Classés par impact sur l'implémentation.

---

## 1. 🔴 Où vivent les questions secrètes ?

**Trois documents, trois réponses.**

| Source | Ce qui est dit |
|---|---|
| DEC-12 | `questions` fait partie de `secret_enc`, niveau 2 — « Relais ne peut ni lire ni modifier » |
| E3-US03 | « Les questions sont stockées **en clair** en base de données » |
| BO-04 | L'utilisateur choisit dans une bibliothèque administrée, il ne peut pas créer ses propres questions |

**Pourquoi c'est bloquant.** T6 (reconstitution post-mortem) exige que l'app
affiche les 3 questions au trusted contact. Le contact ne possède aucune clé
permettant de déchiffrer `secret_enc` — il n'a que ses réponses, et les
réponses ne servent qu'à dériver `K_i` pour ouvrir `S_j_i_enc`. Si les
questions sont dans `secret_enc`, personne ne peut jamais les afficher.

**Ce que j'ai modélisé.** Des références vers la bibliothèque
(`trusted_contact_questions` → `secret_questions`), cohérent avec E3-US03 et
BO-04. Relais peut servir les questions au contact sans rien apprendre : le
texte vient de sa propre bibliothèque. Les réponses restent introuvables.

**À confirmer.** Est-ce que DEC-12 visait autre chose par « questions » — par
exemple une personnalisation libre du libellé, en plus du choix dans la
bibliothèque ? Si l'utilisateur peut reformuler une question, la reformulation
doit être lisible par le contact, donc de niveau 1 (chiffrée avec
`relais_public_key` + signée), pas de niveau 2.

---

## 2. 🟠 HCV Transit : couche de chiffrement ou pas ?

Question déjà posée, mise en pause.

- **Specs Techniques §4.4, T1, T2, T7, T8, Backend Specs §5.1** : P1 → HCV
  Transit → P2 → Storj.
- **DEC-16/17** : HCV retiré du chiffrement des données utilisateur.
  P2 = XChaCha20(K, P1). HCV réduit à `relais_private_key`.

**Impact sur le schéma** : nul, `vault_syncs.hcvKeyVersion` est nullable.

**Impact ailleurs** : majeur. Le job `storj:sync`, le service
`src/services/crypto/hcv.ts`, le circuit breaker HCV, l'alerte « HCV
indisponible > 2min », le monitoring BO-06 et le health check `/health`
existent ou disparaissent selon la réponse.

**Note.** Si DEC-16 l'emporte, T7 (« Déchiffrement HCV : Pi_2 → Pi_1 ») devient
faux : le contact déchiffre directement avec Kj. Et la ligne « HCV piraté »
du tableau des garanties de sécurité (Specs Techniques §9) tombe.

---

## 3. 🟠 D'où viennent K1/K2/K3 : le seed ou le mot de passe ?

| Source | Ce qui est dit |
|---|---|
| Specs Techniques §4.1, §4.5, T5 | `mot de passe → Argon2id → K_login`, K_login permet de recalculer K1/K2/K3 |
| Specs Techniques §7.2 | « Le mot de passe est la seule source de dérivation de K1 K2 K3 » |
| DEC-02 | Le mot de passe sert **uniquement** à l'authentification serveur, aucun rôle cryptographique |
| DEC-01/03/04, Frontend Specs §3.3 | K1/K2/K3 dérivent du seed, déchiffré par le PIN depuis `seed_enc_pin` |

DEC-02 est postérieur et explicite : c'est lui qui fait foi. Mais les Specs
Techniques n'ont pas été mises à jour, et `KeyStore.deriveFromPassword()`
figure toujours dans l'interface du KeyStore (Frontend Specs §3.1) aux côtés
de `deriveFromSeed()`.

**Conséquence si DEC-02 fait foi.** E6-US03 (« Après changement de mot de
passe : K1 K2 K3 sont recalculées, P1 rechiffré, P2 mis à jour ») devient
faux et — bonne nouvelle — beaucoup plus simple : changer le mot de passe
n'a plus aucun effet cryptographique, donc pas de rechiffrement du vault, pas
d'indicateur de chargement, pas de risque de corruption à mi-parcours.

**À confirmer** avant d'écrire le KeyStore.

---

## 4. 🟡 Où se fait la reconstitution finale ?

Specs Techniques §4.8 : « K1, K2, K3 sont en mémoire vive sur le device du
**dernier contact** qui a complété le schéma N-of-M », puis « Dj transmis au
data recipient désigné ».

Mais E3-US04 permet que le data recipient soit **une personne extérieure,
connue par email seul**, qui n'a ni compte ni clé. Comment Dj lui parvient-il
depuis le device du dernier contact, sans que Relais ne voie jamais le clair
(DEC-14) ?

Trois lectures possibles :
1. Le dernier contact exporte et transmet lui-même, hors Relais.
2. Le recipient externe reçoit un lien de type `/relay/:token` avec un
   mécanisme de re-chiffrement à son intention.
3. Le data recipient doit obligatoirement être un trusted contact.

**Ce que j'ai modélisé** : `data_recipients` supporte les deux cas (contact
interne ou email externe chiffré), sans trancher le mécanisme de livraison.

---

## 5. 🟡 Trois versions du step-up token

Les Backend Specs contiennent la section 2.5 **trois fois**, avec des détails
divergents :

| | Endpoint | Header | Usage unique |
|---|---|---|---|
| §2.3 + §2.4 | `POST /auth/stepup` | `X-Stepup-Token` | « recommandé » |
| §2.5 (2ᵉ) | `POST /auth/pin/step-up` | `X-StepUp-Token` | oui, `jti` en Redis |
| §2.5 (3ᵉ) | `POST /auth/pin/step-up` | `X-Step-Up-Token` | oui, blacklist Redis |

§3.1 et les Frontend Specs §4.1 utilisent `POST /auth/pin/step-up` et
`X-Step-Up-Token`. C'est la version majoritaire — je pars là-dessus sauf
objection. Sans impact sur le schéma (le `jti` vit en Redis).

Les listes d'actions divergent aussi légèrement : §2.4 omet
`activate_transmission`, `edit_recipients` et `disable_2fa`, présents dans le
tableau de §2.5. J'ai retenu l'union.

---

## 6. 🟡 Blocage PIN : 30 secondes ou 30 minutes ?

- E1-US03 : « Après 5 tentatives PIN incorrectes : blocage de **30 secondes** »
- Backend Specs §2.5 et BO-05 §5.2 (`pin_lockout_minutes: 30`) : **30 minutes**
- Frontend Specs §7.2 : « 5 échecs PIN → blocage 30min + KeyStore.clear() »

Deux contre un pour 30 minutes. Mais 30 minutes après 5 essais sur un PIN à
6 chiffres, sur un device déjà déverrouillé par l'OS, est très punitif pour
un utilisateur légitime qui hésite — alors que le vrai rempart contre le brute
force est Argon2id, pas le délai. Un backoff progressif (30s, 2min, 10min,
30min) satisferait les deux intentions. Valeur dans `app_config` de toute
façon, donc ajustable sans redéploiement.

---

## 7. 🟡 Le mini-jeu de check-in est-il vraiment sans limite de tentatives ?

E4-US01 : « Si la réponse est incorrecte : l'user peut réessayer **sans
limite** ».
Backend Specs §7.1 : `POST /checkin/game/answer` — **10 req / 1h par user**.

Le rate limit est justifié, mais alors le critère d'acceptation devrait dire
« sans limite dans la limite du rate limiting ». À trancher côté UX : que voit
l'utilisateur au 11ᵉ essai ?

---

## 8. 🟢 Détails mineurs

- **`GET /auth/seed-words`** ne peut pas retourner les 12 mots : le serveur ne
  les a jamais eus. L'endpoint autorise l'app à les réafficher depuis
  `seed_enc_pin`. Modélisé comme `users.seedWordsRevealedAt` + entrée d'audit.
- **Nombre de contacts** : E3-US01 dit « entre 2 et 5 » sans distinguer les
  plans ; BO-05 dit `free_max_contacts: 2` / `premium_max_contacts: 5`. Le
  plan gratuit est donc bloqué à exactement 2, donc à 2-of-2. Cohérent, mais
  l'UX doit l'expliquer plutôt que d'afficher un choix de schéma inerte.
- **Fréquence de check-in** : E3-US05 propose hebdomadaire / mensuel /
  bimestriel ; BO-05 stocke `[1, 2, 4]` semaines. « Bimestriel » (2 mois) ne
  correspond à aucune des trois valeurs — il s'agit probablement de
  bimensuel (2 semaines). Modélisé en semaines.
- **Persona Éric** apparaît dans le tableau récapitulatif du Dossier Produit
  §3 mais n'a pas de fiche. Sans impact technique.
