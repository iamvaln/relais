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
| Push | OneSignal (`react-native-onesignal` + `onesignal-expo-plugin`) | fait au lot 5, voir §3 |

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
5. **Check-in et carnet** (E4-US01, US02, US04, US05, E2-US07, DEC-31/32) —
   fait : statut et ligne du tableau de bord, mini-jeu tiré par le serveur
   avec essais sans limite, validation (série, badges, historique, échéance
   replanifiée), question du mois proposée juste après ; carnet de vie par
   mode (essentiel, réflexif, libre), réponse chiffrée sous K2 et signée,
   relecture déchiffrée, réécriture du mois, suppression signée,
   rattachement au check-in ; rétrospective annuelle calculée sur le device,
   déposée chiffrée et signée, export daté ; push OneSignal : alias
   `SHA256(user_id)`, abonnement déposé à l'API, clic → écran indiqué ; côté
   API le job quotidien pousse le jour de l'échéance, à la relance 1 et trois
   jours avant la fin d'une pause (avec un email), et reprend une pause
   arrivée à son terme.
6. **Parcours du contact** (E5-US01 à US05, F4, E2-US07) — fait : lien reçu
   (`relais://relay/:token` dans l'app, `https://<front>/relay/:token` sur
   la page web `apps/web-relay`), trois questions vérifiées sur le device
   (les réponses ne partent jamais), échecs déclarés et blocage 24 h,
   attente des autres contacts, accès déverrouillé (coffre reconstitué en
   mémoire, checklist Immédiat / Sous 30 jours / À votre discrétion, mots
   de passe masqués, message personnel, carnet de vie pour le Gardien du
   souvenir), progression « Fait » gardée localement jusqu'à la fin de
   l'accès, « J'ai terminé » avec confirmation ; côté API le carnet est
   remis avec K2 et purgé à la fin. La logique vit dans `app-core`
   (`relay/`), partagée par l'app et la page web.

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
| Push : quoi et quand (lot 5) | Trois envois depuis le job quotidien `deadman:checkin` (09:00 UTC) : le premier balayage après l'échéance (« Un petit signe ? »), la relance 1 (E4-US02 : push + email), et J-3 avant la fin d'une pause (E4-US04 : push + email `pause_ending`). Le job reprend aussi une pause arrivée à son terme (check-in replanifié à + fréquence). |
| Push : traçabilité (lot 5) | **Fenêtres du jour, sans table** : le job tourne une fois par jour, chaque envoi est déterminé par le retard (0 jour), le numéro de relance (1) ou les jours restants (3). Aucune migration, aucune trace ; un second run manuel le même jour renverrait le push. Alternative écartée : une table `push_log`. |
| Push : ce qui part (lot 5) | Vers OneSignal : `external_id = SHA256(user_id)`, un titre et une phrase identiques pour tous, la route à ouvrir. Jamais d'email, de nom, de contenu. L'API n'envoie que si le compte a un abonnement actif (`push_tokens`, déposé par `POST /auth/push-token`, désactivé à la déconnexion). Le SDK est initialisé sans App ID en dev : rien ne part tant que `extra.oneSignalAppId` (ou `EXPO_PUBLIC_ONESIGNAL_APP_ID`) est vide. |
| Carnet sur le device (lot 5) | **Serveur seulement, déchiffré à la lecture** : les entrées restent des blobs chez Relais, l'app les liste et les déchiffre avec K2 à l'affichage. Pas de cache local : lecture impossible hors ligne, aucun cas de conflit. |
| Page web du contact (lot 6) | **`apps/web-relay`, page Vite sans framework** : un HTML, TypeScript, crypto-core et app-core embarqués (libsodium en WASM, `Buffer` polyfillé), `VITE_API_URL` au build, construite en CI. Le lien de l'email l'ouvre ; elle propose « Ouvrir dans l'app ». Alternatives écartées : export web de l'app Expo (SQLCipher, OneSignal, SecureStore absents du web), app seule (revenait sur la décision du 11/09). |
| Données du contact (lot 6) | **En mémoire seulement** : le coffre est reconstitué à chaque ouverture depuis l'escrow (accès 30 jours), rien de lisible n'est écrit sur le téléphone ni dans le navigateur. Seule la progression « Fait » est gardée (SecureStore / localStorage), sous le hachage du token, et expire avec l'accès ; « J'ai terminé » l'efface. |
| Carnet au Gardien du souvenir (lot 6) | `GET /relay/:token/data` rend `journal` (mois, mode, blob sous K2) au contact qui porte K2 une fois la catégorie déverrouillée ; la purge finale supprime carnet et rétrospectives (E5-US05 « toutes les données chiffrées »). |
| P2 et fiches (lot 6) | `reconstruct` (crypto-core) ouvre P2 une fois et rend ce que l'owner a scellé : dans l'app, la liste JSON des fiches chiffrées une à une ; app-core déchiffre chaque fiche (Techniques §5.2 décrit P2 = seal(P1) pour un blob unique — la spec est à préciser). |
| Check-in et carnet (lot 5) | Une entrée déjà écrite ce mois est passée à `POST /checkin/complete` (`journal_entry_id`) pour se rattacher au check-in ; écrite après, elle s'y rattache seule (Fix-09a). « Validé par simple ouverture de l'app » n'est pas retenu, comme côté API. |
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

Lot 6 :

- API (1 test de plus, relay : 25) : `journal` rendu au porteur de K2
  déverrouillé, absent pour un porteur K1 ; la purge finale supprime
  carnet et rétrospectives.
- `app-core` (3 tests sous Node) : checklist par urgence toutes catégories
  confondues ; progression par lien sans le token en clair, oubliée après
  l'expiration ; phase du contact (questions → attente → accès → terminé).
- `app-core` contre l'API réelle (2 tests,
  `apps/api/test/app-core-relay.test.ts`) : Adjoua (coffre synchronisé,
  carnet, deux contacts K1+K2), déclenchement, puis Hervé : lien (nom,
  questions), mauvaises réponses détectées sur le device et déclarées
  (tentatives comptées), bonnes réponses (casse et accents indifférents),
  attente 1/2, accès refusé ; Paul répond → 2/2 ; Hervé déverrouille :
  comptes avec mots de passe, messages, pas de finances (K3 sans porteur),
  message personnel, carnet, checklist par urgence, accès à + 30 jours ;
  progression relue par une autre instance ; « J'ai terminé » ×2 → purge,
  lien clos, progression effacée. Cinq mauvaises réponses → blocage 24 h.
- `crypto-core` : `reconstruct` rend P2 ouvert (test et parcours bout en
  bout ajustés).
- web-relay (2 tests) : token lu depuis `/relay/:token` ou `?token=`,
  deep link de l'app.
- Bundle Metro Android et build Vite : construits.

Lot 5 :

- API (13 tests) : `POST/DELETE /auth/push-token` (un token change de
  compte, désactivation, plateforme inconnue → 400, session exigée) ;
  `pushService` (alias = SHA256(user_id), rien sans abonnement actif, rien
  d'identifiant dans la charge) ; `OneSignalTransport` contre un faux
  serveur HTTP (clé REST en en-tête, `app_id`, `include_aliases`, textes,
  route ; erreur HTTP → exception sans la clé) ; job : push le jour de
  l'échéance et pas le lendemain, rien sans abonnement, relance 1 = email +
  push, rappel J-3 de fin de pause (email `pause_ending` tracé + push) une
  seule fois, reprise automatique d'une pause échue (check-in replanifié,
  relances à zéro), une seule fois.
- `app-core` (1 test) : `pushExternalId` = SHA256 hex, sans l'identifiant.
- `app-core` contre l'API réelle (5 tests,
  `apps/api/test/app-core-checkin.test.ts`) : statut, jeu, mauvaise puis
  bonne réponse, validation (série 1, badge `first_checkin`, historique,
  échéance replanifiée) ; sans transmission → code d'erreur ; carnet :
  question du mois par mode, entrée chiffrée (rien de lisible en base) et
  signée, relecture, entrée du mois, réécriture du même mois (409 géré),
  rattachement au check-in, suppression signée qui détache le check-in ;
  Wrapped refusé sous 6 entrées, puis calculé sur le device (mots, modes,
  mois, mois le plus long), déposé chiffré, relu déchiffré, export daté ;
  `wrappedStats` pur.
- mobile (3 tests) : ligne de check-in selon le statut, une phrase par
  badge FR/EN, une notification n'ouvre que `/checkin` ou `/transmission`.
- Bundle Metro Android : construit avec OneSignal et les cinq écrans.

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
  (casse et accents indifférents) attestées sur un challenge serveur à usage
  unique et datées (audit LOW-15) ; pause 30 jours et
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
  enregistrée sous step-up `set_key`, audit LOW-13 → biométrie, mots
  effacés) ; nouveau device : login puis restauration par les 12 mots
  (mauvais mots refusés, email de notification, PIN posé ; la preuve du seed
  `proveSeed` ouvre ensuite `POST /vault/restore` pour quinze minutes) ; mot de passe oublié signé par les 12 mots puis changement avec
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
