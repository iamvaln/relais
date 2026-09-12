# Relais — back office web : notes, lots et décisions

Le back office consomme l'API `/admin/*` (auth TOTP, dashboard,
utilisateurs, transmissions, questions, configuration, audit, facturation,
tickets — `docs/backend.md` §3). Deux workspaces :

- `packages/admin-core` — la logique sans React : `AdminClient` (client de
  l'API admin sur l'enveloppe et les erreurs de `api-client`, jeton bearer
  8 h, **jamais de refresh** : un 401 ferme la session et appelle
  `onSessionLost`), `AdminSession` (login TOTP, restauration au chargement,
  logout) sur un `SessionStore`, la grille des rôles (`canAccess`,
  `modulesFor`, `homeModule`), les filtres de la liste des utilisateurs
  (`usersQuery`) et les types des vues. Tests unitaires sous Node avec un
  faux serveur (`test/`), parcours contre l'API réelle dans
  `apps/api/test/admin-core.test.ts`.
- `apps/web-admin` — l'app React 19 (Vite, react-router, TanStack Query),
  écrans minces sur admin-core, CSS maison aux jetons de la marque (crème,
  encre, doré), FR et EN. `VITE_API_URL` au build, construite en CI. Les
  helpers purs (format, i18n, filtres d'URL, actions par rôle) sont testés
  sous Node avec Vitest.

## 1. Lots

| Lot | Contenu | État |
|---|---|---|
| 1 | Connexion email + mot de passe + TOTP, session 8 h, coquille et menu par rôle, tableau de bord (KPIs, alertes, santé des services), utilisateurs (liste filtrable et paginée, fiche, débloquer, regénérer l'OTP, suspendre, changer l'email, supprimer RGPD avec double confirmation) | ✅ |
| 2 | Transmissions (liste filtrée et paginée, détail en statuts et compteurs, étendre l'escrow +24/48 h, relancer, annuler, débloquer un contact), questions (bibliothèque filtrable, ajout, modification, archivage), configuration (BO-05, par catégorie, validation typée, double confirmation) | ✅ |
| 3 | Facturation (vue d'ensemble, abonnements avec recherche, passage premium, renouvellement, extension, rétrogradation, export CSV), tickets (file filtrable, détail, prise en charge, priorité, résolution, fermeture, réouverture), monitoring (santé de l'API, jobs, compteurs, journal d'audit filtrable avec avant/après) | ✅ |

## 2. Décisions (12 septembre 2026)

| Sujet | Décision |
|---|---|
| Stack | React 19 + Vite + TanStack Query + react-router : sept modules avec tables, filtres et formulaires ; même client API et mêmes conventions de test que le mobile. Alternative écartée : Vite sans framework comme `apps/web-relay` (trop de code à la main pour les tables). |
| Session | Le jeton admin (8 h) vit dans **sessionStorage** : survit au rechargement de l'onglet, disparaît à sa fermeture ; `GET /admin/me` le revalide au chargement ; un jeton expiré localement est oublié sans appel. Jamais localStorage. |
| Rôles | Le menu **masque** les modules hors rôle (grille identique aux preHandler de l'API : super_admin tout ; admin tout sauf configuration et facturation ; support utilisateurs, transmissions, tickets ; finance facturation). Un module hors rôle redirige vers l'accueil du rôle ; l'API refuse de toute façon (`AUTH_FORBIDDEN`), et un 403 n'est pas une perte de session. Sur la fiche utilisateur, les boutons suivent la même grille (`allowedActions`). |
| Langue | FR et EN dès la V1 (bascule gardée dans localStorage, langue du navigateur par défaut, FR sinon). Le test vérifie que les deux dictionnaires ont les mêmes clés. |
| Style | Pas de bibliothèque de composants : un fichier CSS avec les jetons de la landing, tables et formulaires écrits à la main, bundle d'environ 380 ko avant gzip. |
| Filtres | Les filtres et la page de la liste des utilisateurs vivent dans l'URL (partageables, le bouton retour les garde). |
| Suppression RGPD | Double confirmation : motif obligatoire et saisie du mot SUPPRIMER (DELETE en anglais). |
| Zéro-connaissance | Les écrans ne montrent que des métadonnées ; la fiche le rappelle. Aucun champ chiffré n'est demandé à l'API. |

### Lot 2 (12 septembre 2026)

| Sujet | Décision |
|---|---|
| Configuration : double confirmation (BO-05) | **Toutes les clés, quelle que soit la catégorie** : motif obligatoire et ressaisie du nom de la clé (`configChangeConfirmed`). Réservé au super_admin et rare ; la règle unique évite de débattre clé par clé. Alternatives écartées : `dms.*` et `security.*` seulement ; motif seul. |
| Configuration : saisie typée | Le formulaire saisit du texte ; admin-core le convertit selon `config_type` (`int`, `bool`, `array_int` « 7, 14, 21 » ou `[7,14,21]`, `json`, `string`) et refuse avant l'appel ce que l'API refuserait (`VALIDATION_ERROR`). L'effet est immédiat, rappelé en tête d'écran. |
| Questions : import CSV en lot | **Reporté.** L'API n'a pas d'endpoint d'import ; la bibliothèque seedée couvre le lancement et l'ajout unitaire suffit. Un `POST /admin/questions/import` (validation ligne par ligne, rapport d'erreurs) viendra si le besoin se confirme — consigné dans `docs/open-questions.md` §E. |
| Questions : statut par défaut | La liste ouvre sur les questions **actives** (`status=all` dans l'URL retire le filtre) ; l'archivage demande un motif et rappelle que les usages existants restent. |
| Transmissions : actions par rôle | Même grille que l'API (`allowedTransmissionActions`) : support débloque un contact ; admin étend l'escrow et relance ; super_admin annule, avec motif et saisie du mot ANNULER (CANCEL). Une transmission complétée, annulée ou expirée n'a plus d'action. |
| Transmissions : rafraîchissement | La liste se recharge toutes les 60 s (TTL de l'escrow) ; le détail se met à jour depuis la réponse de chaque action. |
| `api-client` dans un navigateur | Bug corrigé dans ce lot : `fetch` était appelé comme méthode de l'instance, ce que Chrome et Firefox refusent (« Illegal invocation ») — les tests sous Node ne le voyaient pas. Le lot 1 et la page web du contact ne pouvaient donc pas joindre l'API depuis un navigateur. Test reproduit avec un `fetch` strict sur `this` (`apps/api/test/api-client.test.ts`). |
| Vérification visuelle | Parcours joué dans Chromium (Playwright, hors dépôt) contre l'API réelle : connexion, déblocage d'un contact, extension d'escrow, ajout d'une question, modification de `dms.escrow_ttl_hours` avec ressaisie de la clé, bascule EN. |

### Lot 3 (12 septembre 2026)

| Sujet | Décision |
|---|---|
| Facturation : retrouver l'abonné | La finance n'a pas le module Utilisateurs. **Ajout API test-first** : `GET /admin/billing/subscriptions` accepte `search` (nom, email, téléphone, comme BO-02) et chaque ligne porte `user_email` et `full_name`. L'export CSV reste sans email (identifiants seulement). Alternative écartée : identifiants seuls, avec dépendance au support. |
| Facturation : actions | Ce que l'API permet (`subscriptionActions`) : un gratuit passe premium ; un premium se renouvelle (12 mois à partir de l'échéance), se prolonge (jours offerts, 1 à 365) ou redescend en gratuit ; un gratuit expiré ou en grâce peut aussi recevoir des jours. Montant pré-rempli avec `billing.premium_price_fcfa`, référence de paiement facultative, motif obligatoire. |
| Facturation : export CSV | Requête brute hors enveloppe (`AdminClient.download`), nom de fichier lu dans `Content-Disposition` — l'API l'expose désormais en CORS (`Access-Control-Expose-Headers`, test `cors.test.ts`), sinon le navigateur ne le voit pas. Fichier enregistré depuis un `Blob`. Un 401 ferme la session comme les autres appels. |
| Tickets : assignation | Lot 3 : à soi-même seulement. **12/09/2026, points ouverts** : `GET /admin/admins` (id, nom, rôle, statut — jamais d'email ; mêmes rôles que les tickets) et un sélecteur « Assigner à » dans le détail du ticket, admins actifs seulement ; le nom de l'assigné remplace son identifiant. La gestion des comptes admin reste en ligne de commande. |
| Tickets : transitions | `nextTicketStatuses` : ouvert → prise en charge ou résolu ; en cours → résolu ; résolu → fermé ou réouvert ; fermé → réouvert. Résoudre exige une note (visible par le demandeur connecté). La priorité se change à tout moment. |
| Monitoring | Santé (`GET /admin/health` : sondes, uptime, jobs, compteurs) rafraîchie toutes les 60 s ; journal d'audit filtrable (action parmi les codes du CHECK, admin, cible, dates) dans l'URL, 50 par page, avant/après dépliables. Aucun contenu utilisateur : identifiants et IP hachée seulement. |
| Menu | Les huit modules existent : la route de repli « bientôt » est retirée, une URL inconnue renvoie à l'accueil du rôle. |
| Vérification visuelle | Chromium contre l'API réelle : recherche d'un abonné, passage premium, téléchargement du CSV (nom `relais-billing-…`), prise en charge et résolution d'un ticket, journal filtré sur `PLAN_CHANGE` avec détails, bascule EN. |

## 3. Lancer

```bash
npm run core:build                       # admin-core → dist/
npm run dev -w apps/web-admin            # http://localhost:5173, API sur VITE_API_URL (défaut http://localhost:3000)
npm run admin:create -w apps/api -- --email … --name … --role super_admin   # un admin, secret TOTP affiché une fois
npm test -w packages/admin-core -w apps/web-admin
```

L'API autorise deux origines navigateur (CORS) : `FRONTEND_URL` (page du
contact) et `ADMIN_URL` (back office, `http://localhost:5173` en
développement, https obligatoire en production).
