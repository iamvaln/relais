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
| 2 | Transmissions (liste, détail, étendre l'escrow, relancer, annuler, débloquer un contact), questions (bibliothèque, ajout, modification, archivage), configuration (BO-05) | ⬜ |
| 3 | Facturation (vue d'ensemble, abonnements, changement de plan, extension, export CSV), tickets, monitoring (santé, audit) | ⬜ |

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
