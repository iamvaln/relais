# RELAIS — App mobile : notes d'implémentation

**Specs de référence** : Frontend Specs v1.1, User Stories v1.0 (E1 à E6),
Flowcharts v1.0 (T1–T8, F1–F4), Dossier produit §2.5 (périmètre V1).
Le cœur crypto est dans `packages/crypto-core` (`docs/crypto-core.md`), le
client HTTP dans `packages/api-client`. L'app ne fait que les brancher.

## 1. Stack

| Composant | Choix | Note |
|---|---|---|
| Framework | Expo SDK 57, React Native 0.86, TypeScript strict | Génération native continue (`expo prebuild`) : `ios/` et `android/` ne sont pas versionnés, les modules natifs passent par des config plugins |
| Navigation | Expo Router (routes typées) | `app/` |
| État | Zustand (stores « vanilla » testables sous Node) | `src/state/` |
| API | TanStack Query + `@relais/api-client` | `src/lib/api.ts` — cookies (refresh token) gérés par le réseau natif |
| Logique | `@relais/app-core` (politique PIN, device, onboarding, session) | sans React Native, testé sous Node et contre l'API |
| Crypto | `@relais/crypto-core` ; `react-native-libsodium` remplace `libsodium-wrappers-sumo` à l'exécution | alias dans `metro.config.js` |
| Secrets locaux | `expo-secure-store` (`seed_enc_pin` + sel, `seed_enc_bio` + clé gardée avec authentification requise — DEC-01) | `src/lib/device.ts` |
| Base locale | `expo-sqlite` + SQLCipher (`useSQLCipher`), clé = Argon2id(seed, `relais_sqlite_v1`) posée par `PRAGMA key` ; une fiche = un blob P1 | `src/lib/vault-db.ts`, `src/state/vault.ts` |
| Biométrie | `expo-local-authentication` (disponibilité) + `requireAuthentication` d'`expo-secure-store` (déverrouillage) | lot 2 |
| Push | OneSignal (`react-native-onesignal` + `onesignal-expo-plugin`) | lot 5, voir §3 |

## 2. Lots (une PR chacun)

1. **Socle** — ce lot : projet Expo, client API partagé et testé contre la
   vraie API, KeyStore (clés en mémoire, auto-verrouillage 10 min), i18n
   FR/EN, écran d'état du service.
2. **Onboarding et sécurité** (E1, E6-US01 à US03) — fait : inscription, OTP,
   12 mots affichés une fois + quiz de deux mots, PIN, biométrie, backoff
   DEC-26, connexion et 2FA, restauration (challenge DEC-06), mot de passe
   oublié, changement de mot de passe, TOTP et codes de récupération.
3. **Coffre** (E2-US01 à US04, US06, E1-US06) — fait : fiches par catégorie
   (comptes, messages, finances) avec niveau d'urgence, chiffrées fiche par
   fiche dans SQLite sous SQLCipher ; liste, filtres, recherche, mot de
   passe masqué, suppression définitive ; sync Storj 3 s après la dernière
   modification, par catégorie ; restauration sur nouveau device ; tableau
   de bord (fiches, dernière sauvegarde) ; tutoriel du premier compte.
   E2-US05 (message personnel) est fait au lot 4, E2-US07 (capsule) va au lot 5.
4. **Transmission** (E3-US01 à US03, US05 à US07, E2-US05, E6-US04) — fait :
   contacts (2 à 5) avec nom, email, téléphone, rôles (Gestionnaire pratique,
   Gardien du souvenir, Exécuteur financier) et trois questions choisies dans
   la bibliothèque (`GET /transmission/questions`), réponses gardées chiffrées
   sur le device, message personnel ; schéma N-of-M expliqué sans jargon,
   silence et fréquence avec la phrase de cohérence ; récapitulatif, PIN,
   activation (parts calculées sur le device), email de désignation ;
   parcours guidé de modification (désactiver → modifier → réactiver) ;
   pause 1 semaine / 1 mois / 3 mois ; vérification annuelle ; « Relais peut /
   ne peut pas » ; statut sur le tableau de bord ; restauration des contacts
   sur un nouveau device. E3-US04 est sans objet (DEC-23 : le destinataire
   est toujours un contact avec rôle).
5. **Check-in et carnet** (E4, journal, Wrapped) : mini-jeu, streak, badges,
   relances push.
6. **Parcours du contact** (E5, F4) : lien reçu, trois questions, attente,
   accès déverrouillé, checklist par urgence, « J'ai terminé » — dans l'app
   par deep link, et sur une page web pour qui n'installe rien.

## 3. Décisions (11 et 12 septembre 2026)

| Point | Décision |
|---|---|
| Le contact passe par l'app ou le navigateur ? | **Les deux.** Le lien de l'email ouvre l'app si elle est installée (deep link `relais://relay/:token`), sinon une page web minimale qui embarque le cœur crypto (il tourne dans un navigateur). On n'impose pas une installation à quelqu'un en deuil. Le Dossier produit met la « version web » hors V1 : celle-ci se limite au parcours du contact. |
| Expo bare ou managed ? | Génération native continue : mêmes capacités que bare (SQLCipher, libsodium natif, OneSignal), sans versionner `ios/` et `android/`. |
| Push | **OneSignal**, à la demande du fondateur, plutôt qu'Expo Push. Contraintes non négociables (CLAUDE.md) : l'identifiant OneSignal de l'utilisateur est `external_id = SHA256(user_id)`, jamais l'email ni le téléphone ; aucune donnée utilisateur dans une notification (« Un petit signe ? », jamais un nom de contact ni un contenu) ; `push_tokens.token` stocke l'identifiant d'abonnement OneSignal ; l'API envoie par l'API REST OneSignal depuis un job (lot 5), la clé REST vit dans les variables d'environnement (DEC-18). |
| Ordre des lots | Celui de §2, dans l'ordre des user stories P0. |
| Tests | La logique vit hors des écrans (stores, hooks, client) et se teste sous Node avec Vitest ; le client API se prouve contre la vraie API (`apps/api/test/api-client.test.ts`). Les écrans restent minces ; la vérification visuelle sur iOS et Android se fait sur un device, les tests Maestro viendront après le lot 2. |
| Biométrie (lot 2) | Une clé de 32 octets gardée par le Keychain / Keystore avec authentification requise chiffre une seconde copie du seed (`seed_enc_bio`). Face ID / empreinte libère la clé ; le PIN reste le secours. |
| Logique de l'app (lot 2) | `packages/app-core`, sans React Native : même recette que crypto-core et api-client, réutilisable par la page web du contact. |
| 12 mots (lot 2) | Case à cocher + deux mots tirés au sort à ressaisir (E1-US02 ne demandait que la case). |
| Mot de passe oublié (lot 2) | Dans le lot 2 : OTP par email + 12 mots qui signent `relais:password-reset:v1:{email}:{code}`. |
| SQLCipher (lot 3) | Le fichier SQLite est chiffré en plus des fiches : clé Argon2id(seed, `relais_sqlite_v1`) INTERACTIVE, dérivée au déverrouillage et effacée au verrouillage. Cache aussi catégories, urgences et dates à qui extrait le fichier. |
| Backup (lot 3) | Un blob par catégorie, comme l'API : P2 = seal(Ki, JSON(lignes chiffrées)), signé. Restaurer = réécrire les lignes telles quelles. |
| PIN finances (lot 3) | E2-US03 : le PIN est ressaisi localement (ou biométrie) avant d'enregistrer une fiche finances. Aucun step-up serveur : le coffre est local. |
| Périmètre du lot 3 | E2-US05 (message personnel par contact) est le `secret_enc` du contact → lot 4 ; E2-US07 (capsule temps) est le carnet de vie → lot 5. |
| Réponses secrètes (lot 4) | **Sur le device, chiffrées** (table `contacts`, blob sous K2 dans la base SQLCipher), jamais synchronisées, jamais envoyées. Modifier un contact puis réactiver ne redemande rien sur ce device ; sur un nouveau device elles sont à ressaisir (l'écran le dit, l'activation le refuse tant qu'il en manque). E3-US03 « jamais stockées » vaut pour le serveur. |
| Email et téléphone du contact (lot 4) | Ajoutés à `secret_enc` (déjà sous K2, déjà remis au contact au relay : il connaît son propre email) et `GET /transmission/config` rend `secret_enc` à l'owner. Un nouveau device restaure nom, email, téléphone, message et rôles avec les 12 mots. Le serveur reste aveugle. Alternative écartée : une quatrième catégorie de backup (migration, API et sync à étendre). |
| Modifier une transmission active (lot 4) | **Parcours guidé** : un bouton « Modifier la transmission », l'avertissement, le PIN, la désactivation (parts purgées), l'édition libre, puis le récapitulatif et le PIN pour réactiver ; tant que ce n'est pas réactivé, le tableau de bord dit « inactive ». Les écrans d'édition sont verrouillés quand la transmission est active. |
| PIN et step-up (lot 4) | Le PIN est vérifié sur le device (`PinConfirm`, DEC-26) avant chaque action qui porte un step-up (`edit_contacts`, `edit_transmission`, `activate_transmission`, `delete_transmission`). Créer un contact avant activation ne demande pas de PIN ; le modifier, le retirer, changer schéma ou délais, activer, désactiver, mettre en pause, oui. La reprise après pause, non (l'API non plus). |
| Rôle dans `secret_enc` (lot 4) | `role` = les rôles détenus, `k1,k2,k3` joints par des virgules ; l'app du contact (lot 6) traduit. |
| Écart de spec | E6-US03 dit qu'après un changement de mot de passe « K1 K2 K3 sont recalculées, P1 rechiffré ». Depuis DEC-02/05 les clés viennent du seed : rien à rechiffrer. À corriger dans les User Stories. |

## 4. Lancer

```bash
npm install
npm run core:build                 # crypto-core et api-client → dist/
npm run mobile typecheck && npm run mobile lint && npm run mobile test
cd apps/mobile && npx expo prebuild   # génère ios/ et android/ (non versionnés)
npx expo run:ios                      # ou run:android
```

`expo install` ne joint pas les serveurs Expo depuis l'environnement de
développement distant (proxy) : les versions viennent de
`expo/bundledNativeModules.json`, installées avec `npm install`.

Contraintes Metro, vérifiées par `npx expo export --platform android` (aussi
en CI) : dans `apps/mobile`, imports relatifs **sans extension** (Metro ne
mappe pas `./x.js` vers `x.ts`) ; `Buffer` polyfillé par `src/lib/polyfills.ts`
(Hermes n'en a pas, les packages l'utilisent pour base64) ;
`libsodium-wrappers-sumo` aliasé vers `react-native-libsodium`.

## 5. Vérifications

Lot 4 :

- `app-core` (3 tests sous Node, vraie SQLite) : contact ajouté / relu /
  modifié / retiré, rien de lisible dans la base (nom, email, téléphone,
  réponses, message absents du BLOB ; rôles et questions en colonnes),
  positions jamais réattribuées, recherche par identifiant serveur,
  remplacement complet à la restauration, nom et email obligatoires.
- `app-core` contre l'API réelle (3 tests,
  `apps/api/test/app-core-transmission.test.ts`) : bibliothèque de
  questions ; contacts créés puis modifiés (step-up), blobs opaques en base ;
  `checkActivation` dit avant l'appel ce qui manque (moins de deux contacts,
  rôle avec moins de N porteurs, réponses absentes) ; schéma, délais,
  activation avec parts calculées sur le device et email de désignation au
  prénom de l'owner ; contacts figés (`TRANSMISSION_ALREADY_ACTIVE`,
  `isEditable`) ; parcours désactiver → modifier / retirer / ajouter →
  réactiver, contacts reprévenus ; vérification annuelle : mauvaises
  réponses détectées sur le device sans appel serveur, bonnes réponses
  (casse et accents indifférents) attestées et datées ; pause 30 jours et
  reprise ; nouveau device : contacts restaurés depuis `secret_enc` avec
  rôles et questions, réponses `null`, activation refusée tant qu'elles
  manquent, restauration idempotente qui garde les réponses ressaisies ;
  erreurs API (`ApiError`) remontées avec leur code.
- API (2 tests) : `GET /transmission/questions` ne rend que les questions
  actives, `secret_question` ou `both`, score ≥ `vault.question_min_score`,
  groupées par catégorie ; session exigée ; `GET /transmission/config` rend
  `secret_enc`.
- crypto-core (1 test) : `secret_enc` porte email et téléphone, `openSecret`
  les rend.
- mobile (4 tests) : occasions de check-in selon silence et fréquence,
  phrase du schéma FR/EN (« Il faudra que 2 de tes 3 contacts répondent… »),
  une phrase par problème d'activation, ligne de statut du tableau de bord.
- Bundle Metro Android : construit avec les sept écrans de transmission.

Lot 3 :

- `app-core` (6 tests sous Node, vraie SQLite via `node:sqlite`) : fiche
  ajoutée / relue / modifiée / supprimée, rien de lisible dans la base
  (service, identifiant, mot de passe, instructions absents du BLOB),
  filtres catégorie et urgence, recherche sans casse ni accents, comptes
  par catégorie, clés d'un autre seed refusées, export / import d'une
  catégorie ; sync : un envoi 3 s après la dernière modification par
  catégorie touchée, P2 signé et opaque, `flushAll`, suppression
  synchronisée, restauration qui remplace la catégorie.
- `app-core` contre l'API réelle (`apps/api/test/app-core-vault.test.ts`) :
  sync après modification, statut par catégorie, P2 opaque sur le stockage,
  restauration complète sur un nouveau device.
- mobile : KeyStore dérive et efface la clé SQLCipher ; bundle Metro Android.

Lot 2 :

- `app-core` (8 tests sous Node) : PIN faibles refusés (format, répétition,
  suite, motif), backoff 0/30/120/600/1800 s, compteur persistant ; device :
  `seed_enc_pin` sans clair dans le stockage, bon PIN → seed, mauvais PIN
  compté puis bloqué 30 s, changement de PIN, biométrie (clé avec
  authentification, refus → erreur, désactivation), `wipe`.
- `app-core` contre l'API réelle (4 tests, `apps/api/test/app-core.test.ts`) :
  onboarding complet (compte → OTP → 12 mots → quiz → PIN → clé publique
  enregistrée → biométrie, mots effacés) ; nouveau device : login puis
  restauration par les 12 mots (mauvais mots refusés, email de notification,
  PIN posé) ; mot de passe oublié signé par les 12 mots puis changement avec
  step-up qui révoque les autres sessions ; TOTP avec 8 codes de
  récupération, login en deux temps par TOTP puis par code de secours,
  désactivation.
- mobile (5 tests) : écran d'entrée selon session, device et KeyStore.
- Bundle Metro Android : construit (alias libsodium, polyfill, imports).

Lot 1 :

- `api-client` (3 tests, contre l'API réelle sur un port éphémère) :
  enveloppe déballée, `ApiError { status, code, message, details }`, 404 ;
  inscription → OTP → session, `me`, access token périmé → un refresh par
  le cookie puis la requête rejouée, logout puis 401 ; login, step-up et
  `X-Step-Up-Token`, 403 sans.
- mobile (4 tests) : KeyStore verrouillé au départ, déverrouillage dérive
  les clés et efface le seed, verrouillage met les clés à zéro,
  auto-verrouillage à 10 min et pas avant, `touch()` repousse ; i18n :
  mêmes clés FR/EN, aucune vide, interpolation.
