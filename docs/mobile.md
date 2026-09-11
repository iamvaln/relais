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
| Crypto | `@relais/crypto-core` ; `react-native-libsodium` remplace `libsodium-wrappers-sumo` à l'exécution | alias Metro à poser au lot 2 |
| Secrets locaux | `expo-secure-store` (`seed_enc_pin` + sel, permanents — DEC-01) | lot 2 |
| Base locale | `expo-sqlite` chiffré (P1 par catégorie) | lot 3 |
| Biométrie | `expo-local-authentication` | lot 2 |
| Push | OneSignal (`react-native-onesignal` + `onesignal-expo-plugin`) | lot 5, voir §3 |

## 2. Lots (une PR chacun)

1. **Socle** — ce lot : projet Expo, client API partagé et testé contre la
   vraie API, KeyStore (clés en mémoire, auto-verrouillage 10 min), i18n
   FR/EN, écran d'état du service.
2. **Onboarding et sécurité** (E1, E6-US01/02) : inscription, OTP, 12 mots
   affichés une fois, PIN, biométrie, backoff DEC-26, restauration
   (challenge DEC-06), 2FA et codes de récupération.
3. **Coffre** (E2) : SQLite chiffré, comptes / messages / finances, niveaux
   d'urgence, sync Storj après 3 s d'inactivité, restauration P2.
4. **Transmission** (E3) : contacts, questions de la bibliothèque, rôles,
   schéma N-of-M, activation avec step-up, vérification annuelle.
5. **Check-in et carnet** (E4, journal, Wrapped) : mini-jeu, streak, badges,
   relances push, pause.
6. **Parcours du contact** (E5, F4) : lien reçu, trois questions, attente,
   accès déverrouillé, checklist par urgence, « J'ai terminé » — dans l'app
   par deep link, et sur une page web pour qui n'installe rien.

## 3. Décisions (11 septembre 2026)

| Point | Décision |
|---|---|
| Le contact passe par l'app ou le navigateur ? | **Les deux.** Le lien de l'email ouvre l'app si elle est installée (deep link `relais://relay/:token`), sinon une page web minimale qui embarque le cœur crypto (il tourne dans un navigateur). On n'impose pas une installation à quelqu'un en deuil. Le Dossier produit met la « version web » hors V1 : celle-ci se limite au parcours du contact. |
| Expo bare ou managed ? | Génération native continue : mêmes capacités que bare (SQLCipher, libsodium natif, OneSignal), sans versionner `ios/` et `android/`. |
| Push | **OneSignal**, à la demande du fondateur, plutôt qu'Expo Push. Contraintes non négociables (CLAUDE.md) : l'identifiant OneSignal de l'utilisateur est `external_id = SHA256(user_id)`, jamais l'email ni le téléphone ; aucune donnée utilisateur dans une notification (« Un petit signe ? », jamais un nom de contact ni un contenu) ; `push_tokens.token` stocke l'identifiant d'abonnement OneSignal ; l'API envoie par l'API REST OneSignal depuis un job (lot 5), la clé REST vit dans les variables d'environnement (DEC-18). |
| Ordre des lots | Celui de §2, dans l'ordre des user stories P0. |
| Tests | La logique vit hors des écrans (stores, hooks, client) et se teste sous Node avec Vitest ; le client API se prouve contre la vraie API (`apps/api/test/api-client.test.ts`). Les écrans restent minces ; la vérification visuelle sur iOS et Android se fait sur un device, les tests Maestro viendront après le lot 2. |

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

## 5. Vérifications

- `api-client` (3 tests, contre l'API réelle sur un port éphémère) :
  enveloppe déballée, `ApiError { status, code, message, details }`, 404 ;
  inscription → OTP → session, `me`, access token périmé → un refresh par
  le cookie puis la requête rejouée, logout puis 401 ; login, step-up et
  `X-Step-Up-Token`, 403 sans.
- mobile (4 tests) : KeyStore verrouillé au départ, déverrouillage dérive
  les clés et efface le seed, verrouillage met les clés à zéro,
  auto-verrouillage à 10 min et pas avant, `touch()` repousse ; i18n :
  mêmes clés FR/EN, aucune vide, interpolation.
