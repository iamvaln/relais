RELAIS
Passe le relais, pas le chaos.
Back Office — Specs v1.0
Avril 2026 — Confidentiel
# Introduction
Le back office Relais est l'interface d'administration interne. Il permet à l'équipe de gérer les utilisateurs, configurer le système, monitorer l'infrastructure, et traiter les demandes de support.
| Contrainte zero-knowledge : par design, aucun administrateur ne peut lire le contenu des vaults, les données des contacts, les questions secrètes, les messages personnels, ou toute donnée chiffrée. Le back office ne manipule que des métadonnées. |

## Rôles et permissions
4 rôles sont définis pour la V1. En V1, Valentine est Super Admin uniquement.
| Rôle | Accès | V1 |
| Super Admin | Accès total à tous les modules. Gestion des autres admins. | Valentine uniquement |
| Admin | Tous les modules sauf création d'admins et config système critique. | Non utilisé en V1 |
| Support | Utilisateurs, transmissions, tickets. Pas de config ni facturation. | Non utilisé en V1 |
| Finance | Facturation et abonnements uniquement. | Non utilisé en V1 |

## Modules
| Code | Module | Description |
| BO-01 | Dashboard | Vue d'ensemble en temps réel — KPIs, alertes, santé système |
| BO-02 | Utilisateurs | Gestion des comptes, support, déblocages, suppressions RGPD |
| BO-03 | Transmissions | Logs des dead man's switch, statuts, gestion des escrows |
| BO-04 | Questions | Bibliothèque de questions secrètes — ajout, scoring, gestion |
| BO-05 | Configuration | Paramètres système, sécurité, notifications, abonnements |
| BO-06 | Monitoring | Statut HCV, Storj, PostgreSQL, alertes, logs API |
| BO-07 | Facturation | Abonnements actifs, revenus, churns, renouvellements |

| BO-01 — DashboardVue d'ensemble de la santé du produit en temps réel.Accès : Super Admin, Admin |

KPIs affichés
| Métrique | Calcul | Rafraîchissement |
| Utilisateurs totaux | Nombre de comptes créés (actifs + inactifs) | Temps réel |
| Utilisateurs actifs 30j | Comptes ayant ouvert l'app dans les 30 derniers jours | Quotidien |
| Premium actifs | Abonnements premium non expirés | Temps réel |
| Transmissions déclenchées | Dead man's switch activés ce mois | Quotidien |
| Transmissions complétées | Transmissions avec confirmation des contacts | Quotidien |
| Taux de check-in | % d'utilisateurs ayant validé leur dernier check-in | Quotidien |
| Revenus du mois | Somme des abonnements renouvelés ce mois | Quotidien |
| Tickets support ouverts | Tickets en attente de traitement | Temps réel |

Alertes actives
Le dashboard affiche les alertes actives par ordre de criticité. Une alerte persiste jusqu'à résolution manuelle ou automatique.
| Type d'alerte | Criticité | Condition de déclenchement |
| HCV indisponible | Critique | API HCV ne répond pas depuis > 2 minutes |
| Storj dégradé | Haute | Taux d'erreur Storj > 5% sur 10 minutes |
| Escrow expirant | Haute | Escrow TTL < 12h sans completion |
| Pic d'échecs questions | Haute | Plus de 3 contacts bloqués sur 1h |
| Compte verrouillé > 24h | Moyenne | Compte bloqué sans demande de déblocage |
| Erreur API > seuil | Moyenne | Taux d'erreur API > seuil configuré sur 15 min |
| Espace Storj > 80% | Basse | Utilisation stockage dépasse le seuil configuré |

| BO-02 — UtilisateursGestion des comptes utilisateurs et actions de support.Accès : Super Admin, Admin, Support |

Liste des utilisateurs
La liste affiche les colonnes suivantes et supporte la recherche par email, nom, ou numéro de téléphone.
| Colonne | Source | Filtrable |
| ID | PostgreSQL uuid | Non |
| Nom | Profil utilisateur | Oui |
| Email | Profil utilisateur | Oui |
| Plan | Gratuit / Premium | Oui |
| Statut | Actif / Suspendu / Supprimé | Oui |
| Transmission | Non configurée / Active / Déclenchée | Oui |
| Dernier check-in | Timestamp PostgreSQL | Oui (par plage) |
| Date création | Timestamp PostgreSQL | Oui (par plage) |

| Aucune donnée du vault, des contacts, des questions ou des messages n'est visible dans la liste ou le détail utilisateur. |

Fiche utilisateur — actions disponibles
| Action | Description | Rôle requis | Précautions |
| Débloquer le compte | Réinitialise le compteur d'échecs PIN/mot de passe. Déverrouille la session. | Support | Notifier l'utilisateur par email automatiquement |
| Regénérer OTP email | Génère et envoie un nouvel OTP si l'original a expiré ou n'est jamais arrivé. | Support | Logger l'action avec timestamp et admin ID |
| Débloquer un contact | Réinitialise le compteur d'échecs aux questions secrètes d'un trusted contact sur une transmission. | Support | Notifier l'owner si transmission active |
| Étendre l'escrow | Prolonge le TTL d'un escrow actif de 24h ou 48h supplémentaires. | Admin | Maximum 2 extensions par transmission |
| Suspendre le compte | Bloque l'accès sans supprimer les données. Transmission mise en pause. | Admin | Email de notification obligatoire à l'utilisateur |
| Changer l'email | Mise à jour de l'email après vérification manuelle d'identité. | Admin | Vérification d'identité requise. Logger avant/après. |
| Changer le téléphone | Mise à jour du numéro après vérification manuelle. | Admin | Même précautions que changement email |
| Supprimer le compte (RGPD) | Suppression complète : PostgreSQL + Storj + Si_enc. Log de suppression conservé sans données personnelles. | Super Admin | Irréversible. Confirmation double requise. Transmission annulée. |
| Renouveler abonnement | Force le renouvellement ou accorde une extension gratuite. | Finance, Super Admin | Logger le motif |

Cas de support spécifiques
1. Compte bloqué après trop d'échecs
- L'admin voit le statut 'Bloqué' + le nombre de tentatives échouées + la date du blocage
- Action : Débloquer → réinitialise le compteur et déverrouille
- Email automatique à l'utilisateur : 'Votre compte a été débloqué suite à votre demande de support'
- Si le blocage semble suspect (trop d'IPs différentes) : option Suspendre le compte à la place
2. OTP non reçu ou expiré
- L'admin vérifie les logs d'envoi email (section Monitoring > Logs email)
- Si l'email est bien parti mais non reçu : vérifier si l'adresse est correcte
- Action : Regénérer OTP → envoie un nouveau code valable 10 minutes
- Maximum 5 regénérations par heure pour un même email (anti-abus)
3. Contact bloqué sur une transmission
- L'admin voit : transmission ID, contact bloqué (sans nom ni questions — zero knowledge), timestamp du blocage, nombre de tentatives
- Action : Débloquer le contact → réinitialise ses 5 tentatives
- L'admin NE PEUT PAS voir les questions ni les réponses — uniquement le statut
- Si blocage suspect : option Annuler la transmission avec notification à l'owner si il est encore en vie (vérification manuelle requise)
4. Demande de suppression RGPD
- L'admin reçoit la demande via ticket support
- Vérification d'identité manuelle requise avant suppression
- La suppression déclenche : suppression PostgreSQL (profil, metadata, questions, Si_enc) + suppression Storj (Pi_2) + annulation transmission
- Un log minimal est conservé : user_id anonymisé, date de suppression, motif. Aucune donnée personnelle.
- Délai légal maximum : 30 jours après la demande (RGPD)
| BO-03 — TransmissionsSuivi des dead man's switch déclenchés et gestion des escrows en cours.Accès : Super Admin, Admin, Support |

Liste des transmissions
| Colonne | Description |
| ID transmission | UUID anonyme — pas lié au nom de l'utilisateur dans la liste |
| Statut | En attente de déclenchement / Déclenchée / En cours / Complétée / Annulée / Expirée |
| Date déclenchement | Timestamp du premier email envoyé aux contacts |
| Contacts notifiés | Nombre de contacts notifiés (pas leurs noms) |
| Contacts confirmés | Nombre de contacts ayant validé leur identité |
| Schéma N-of-M | Ex: 2/3 — sans identifier les contacts |
| Escrow actif | Oui / Non + TTL restant si actif |
| Date complétion | Timestamp de la confirmation finale si complétée |

Actions disponibles
| Action | Condition | Rôle requis |
| Voir les logs détaillés | Toujours | Support |
| Étendre le TTL de l'escrow | Escrow actif + < 2 extensions déjà faites | Admin |
| Relancer les notifications | Transmission déclenchée + contacts non répondus | Admin |
| Annuler la transmission | Transmission non encore complétée | Super Admin |
| Forcer la clôture | Transmission expirée sans completion — nettoyage manuel | Super Admin |

| Le contenu des messages, les données du vault, et l'identité des contacts ne sont jamais visibles dans ce module. Seuls les statuts et timestamps sont accessibles. |

| BO-04 — Bibliothèque de questions secrètesGestion de la base de questions proposées aux utilisateurs lors de la configuration de leurs trusted contacts.Accès : Super Admin, Admin |

Pourquoi une bibliothèque administrée
Les questions secrètes sont le seul mécanisme de vérification d'identité des trusted contacts. Des questions mal choisies (informations publiques, oubliables, ambiguës) compromettent toute la sécurité de la transmission. La plateforme propose une liste validée plutôt que de laisser l'utilisateur inventer les siennes.
| L'utilisateur peut personnaliser les questions parmi la bibliothèque proposée, mais ne peut pas en créer de toutes pièces. Cela garantit un niveau de qualité minimal sur toutes les questions du système. |

Structure d'une question
| Champ | Type | Description |
| ID | UUID | Identifiant unique |
| Texte FR | String | Libellé en français |
| Texte EN | String | Libellé en anglais |
| Catégorie | Enum | Enfance / Lieux / Événements / Personnes / Habitudes / Autres |
| Score de fiabilité | Int 1-10 | Évaluation de la résistance aux erreurs et devinettes |
| Statut | Enum | Active / Archivée / En révision |
| Risques | Text | Notes sur les risques identifiés (usage interne) |
| Nb utilisateurs | Int | Nombre de fois utilisée (lecture seule) |
| Date création | Timestamp |  |
| Date modification | Timestamp |  |

Critères de qualité d'une bonne question
- Réponse stable dans le temps — pas quelque chose qui peut changer
- Connue uniquement du contact ciblé — pas publique ni devinable
- Réponse précise et univoque — pas de synonymes acceptables qui créent de l'ambiguïté
- Pas liée à des informations disponibles en ligne (réseaux sociaux, presse)
- Pas liée à un document officiel facilement consultable (date de naissance, CNI, passeport)
Exemples par catégorie
| Catégorie | Bonne question | Mauvaise question (et pourquoi) |
| Enfance | Quel était le prénom de votre meilleure amie en 6e ? | Où êtes-vous né(e) ? (public, sur les réseaux) |
| Enfance | Quel surnom vous donnait votre grand-mère maternelle ? | Quelle est votre date de naissance ? (public) |
| Lieux | Dans quelle rue habitait votre oncle maternel quand vous étiez enfant ? | Quelle est votre ville natale ? (public) |
| Événements | Quel film regardiez-vous en boucle avec votre père enfant ? | Quelle est votre équipe de foot préférée ? (public) |
| Personnes | Comment s'appelait votre premier professeur de piano ? | Comment s'appelle votre mère ? (potentiellement public) |
| Habitudes | Quel est le plat que votre mère préparait pour votre anniversaire ? | Quel est votre plat préféré ? (peut changer) |

Actions disponibles
| Action | Description | Rôle requis |
| Ajouter une question | Créer une nouvelle question FR + EN avec catégorie et score | Admin |
| Modifier une question | Mettre à jour le libellé ou le score | Admin |
| Archiver une question | Retire la question des propositions sans supprimer les usages existants | Admin |
| Activer / Désactiver | Contrôle si la question est proposée aux nouveaux utilisateurs | Admin |
| Voir les statistiques | Nb utilisateurs, taux d'échec aux questions de cette catégorie | Admin |
| Importer en lot | CSV FR/EN avec catégorie et score — pour ajouter des séries de questions | Super Admin |

Score de fiabilité — grille de notation
| Score | Signification | Critères |
| 9-10 | Excellente | Stable, privée, précise, non devinable, non publique |
| 7-8 | Bonne | Stable et privée, légère ambiguïté possible sur la formulation |
| 5-6 | Acceptable | Réponse stable mais potentiellement connue d'un cercle plus large |
| 3-4 | Risquée | Peut changer ou être devinable — à utiliser avec précaution |
| 1-2 | Déconseillée | Publique, instable, ou trop ambiguë — archiver dès que possible |

Seules les questions avec un score >= 6 sont proposées par défaut. Ce seuil est configurable dans BO-05.
| BO-05 — Configuration systèmeParamètres globaux du produit — dead man's switch, sécurité, notifications, abonnements, vault.Accès : Super Admin uniquement |

| Toute modification de configuration est loggée avec : timestamp, admin ID, valeur avant, valeur après. Les modifications critiques requièrent une double confirmation. |

5.1 Dead man's switch
| Paramètre | Type | Défaut | Description |
| durations_available | Array int | [1, 3, 6] | Durées disponibles en mois dans l'UI utilisateur |
| checkin_frequencies | Array int | [1, 2, 4] | Fréquences en semaines disponibles pour le check-in |
| relance_intervals_days | Array int | [7, 14, 21] | Intervalles entre les 3 relances (en jours) |
| relance_count | Int | 3 | Nombre de relances avant déclenchement |
| escrow_ttl_hours | Int | 72 | Durée de vie de l'escrow en heures |
| escrow_max_extensions | Int | 2 | Nombre max d'extensions admin par transmission |
| pause_max_months | Int | 3 | Durée maximum du mode Pause |

5.2 Sécurité du compte
| Paramètre | Type | Défaut | Description |
| pin_max_attempts | Int | 5 | Tentatives PIN incorrectes avant blocage |
| pin_lockout_minutes | Int | 30 | Durée du blocage PIN en minutes |
| password_max_attempts | Int | 5 | Tentatives mot de passe avant blocage |
| account_lockout_minutes | Int | 15 | Durée du blocage compte en minutes |
| session_lifetime_months | Int | 3 | Durée de vie de la session avant déconnexion automatique |
| otp_validity_minutes | Int | 10 | Durée de validité de l'OTP email |
| otp_max_attempts | Int | 5 | Tentatives OTP avant invalidation |
| otp_regen_hourly_max | Int | 5 | Max de regénérations OTP par heure par email (anti-abus) |
| contact_max_attempts | Int | 5 | Tentatives questions secrètes avant blocage du contact |
| contact_lockout_hours | Int | 24 | Durée du blocage contact après trop d'échecs |

5.3 Vault et limites
| Paramètre | Type | Défaut | Description |
| free_max_accounts | Int | 5 | Nombre max de comptes en plan gratuit |
| free_max_contacts | Int | 2 | Nombre max de trusted contacts en plan gratuit (minimum incompressible) |
| premium_max_contacts | Int | 5 | Nombre max de trusted contacts en plan premium |
| max_vault_size_mb | Int | 50 | Taille max du vault par utilisateur en Mo |
| question_min_score | Int | 6 | Score minimum pour qu'une question soit proposée |
| questions_per_contact | Int | 3 | Nombre de questions à définir par trusted contact |

5.4 Notifications et emails
| Paramètre | Type | Description |
| email_from_name | String | Nom de l'expéditeur affiché (ex: 'Relais') |
| email_from_address | String | Adresse email d'envoi |
| email_reply_to | String | Adresse pour les réponses support |
| supported_languages | Array | Langues disponibles pour les emails et l'UI (défaut: ['fr', 'en']) |
| templates | Object | Templates HTML des emails (relances, transmission, OTP, confirmation) |

5.5 Abonnements
| Paramètre | Type | Défaut | Description |
| premium_price_fcfa | Int | 10000 | Prix de l'abonnement premium annuel en FCFA |
| grace_period_days | Int | 7 | Jours de grâce après expiration avant suspension |
| trial_days | Int | 0 | Jours d'essai gratuit (0 = désactivé) |
| currency | String | XAF | Devise (XAF = FCFA) |

| BO-06 — MonitoringSurveillance de l'infrastructure en temps réel.Accès : Super Admin, Admin |

6.1 Statut des services
| Service | Métriques surveillées | Alerte si |
| HashiCorp Vault (HCV) | Disponibilité, latence API encrypt/decrypt, taux d'erreur | Indisponible > 2min ou erreur > 2% |
| Storj | Disponibilité, taux d'erreur upload/download, espace utilisé | Indisponible > 5min ou erreur > 5% |
| PostgreSQL | Disponibilité, latence requêtes, connexions actives, taille BD | Indisponible > 1min ou latence > 500ms |
| API Relais (Node.js) | Uptime, taux d'erreur 4xx/5xx, latence P95, requêtes/min | Erreur > seuil configuré ou latence P95 > 2s |
| Serveur email | Taux de délivrance, bounces, taux d'échec envoi | Taux d'échec > 5% sur 30 minutes |

6.2 Logs API
Chaque appel API est loggé avec : timestamp, endpoint, méthode HTTP, code de réponse, latence, user_id anonymisé (hash). Les logs sont consultables avec filtres par endpoint, code de réponse, et plage de temps.
| Les logs ne contiennent jamais de contenu de vault ni de données sensibles. Uniquement des métadonnées d'appel. |

6.3 Logs d'actions admin
Toute action effectuée dans le back office est loggée de façon immuable :
| Champ | Description |
| Timestamp | Date et heure exactes |
| Admin ID | Identifiant de l'administrateur |
| Action | Type d'action (déblocage, suppression, modification config, etc.) |
| Cible | ID anonymisé de l'entité concernée (user_id, transmission_id, etc.) |
| Avant | Valeur avant modification (pour les configs) |
| Après | Valeur après modification (pour les configs) |
| IP | Adresse IP de l'admin au moment de l'action |

| BO-07 — FacturationSuivi des abonnements, revenus, et gestion des cas particuliers.Accès : Super Admin, Finance |

Vue d'ensemble
| Métrique | Description |
| MRR (Monthly Recurring Revenue) | Revenus mensuels récurrents estimés |
| ARR (Annual Recurring Revenue) | Revenus annuels estimés |
| Abonnements actifs | Nombre de comptes premium en cours |
| Renouvellements ce mois | Abonnements renouvelés dans le mois courant |
| Churns ce mois | Abonnements non renouvelés dans le mois courant |
| Comptes en période de grâce | Abonnements expirés dans les 7 jours de grâce |
| Revenus cumulés | Total depuis le lancement |

Actions disponibles
| Action | Description | Rôle requis |
| Accorder une extension | Prolonge un abonnement premium sans paiement (ex: geste commercial) | Finance, Super Admin |
| Forcer un renouvellement | Déclenche manuellement le renouvellement d'un abonnement | Finance, Super Admin |
| Rétrograder en gratuit | Passe un compte premium en gratuit immédiatement | Finance, Super Admin |
| Upgrader en premium | Passe un compte gratuit en premium manuellement | Finance, Super Admin |
| Exporter les données | Export CSV des abonnements et revenus pour une période donnée | Finance, Super Admin |

— Fin des Specs Back Office v1.0 —
Prochaine étape : Wireframes Back Office
