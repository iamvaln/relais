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
| Base locale | `expo-sqlite` chiffré (P1 par catégorie) | lot 3 |
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
| Biométrie (lot 2) | Une clé de 32 octets gardée par le Keychain / Keystore avec authentification requise chiffre une seconde copie du seed (`seed_enc_bio`). Face ID / empreinte libère la clé ; le PIN reste le secours. |
| Logique de l'app (lot 2) | `packages/app-core`, sans React Native : même recette que crypto-core et api-client, réutilisable par la page web du contact. |
| 12 mots (lot 2) | Case à cocher + deux mots tirés au sort à ressaisir (E1-US02 ne demandait que la case). |
| Mot de passe oublié (lot 2) | Dans le lot 2 : OTP par email + 12 mots qui signent `relais:password-reset:v1:{email}:{code}`. |
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
