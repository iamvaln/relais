RELAIS
Passe le relais, pas le chaos.
Back Office Specs — Version 1.1
v1.1 — 7 modules. D.4 (transmission_stalled), D.5 (logs API export externe).
Avril 2026 — Confidentiel
# Introduction
Le back office Relais est l'interface d'administration interne. Il permet à l'équipe de gérer les utilisateurs, configurer le système, monitorer l'infrastructure, et traiter les demandes de support.
| Contrainte zero-knowledge : aucun administrateur ne peut lire le contenu des vaults, les données des contacts, les questions secrètes, les messages personnels, ou toute donnée chiffrée. Le back office ne manipule que des métadonnées. |

## Rôles et permissions
| Rôle | Accès | V1 |
| Super Admin | Accès total. Gestion des autres admins. | Valentine uniquement |
| Admin | Tous modules sauf création admins et config critique. | Non utilisé en V1 |
| Support | Utilisateurs, transmissions, tickets. Pas de config ni facturation. | Non utilisé en V1 |
| Finance | Facturation et abonnements uniquement. | Non utilisé en V1 |

## Modules
| Code | Module | Description |
| BO-01 | Dashboard | Vue d'ensemble temps réel — KPIs, alertes, santé système |
| BO-02 | Utilisateurs | Gestion comptes, support, déblocages, suppressions RGPD |
| BO-03 | Transmissions | Logs DMS, statuts, gestion escrows, transmissions stalled |
| BO-04 | Questions | Bibliothèque questions secrètes — ajout, scoring, gestion |
| BO-05 | Configuration | Paramètres système, sécurité, notifications, abonnements |
| BO-06 | Monitoring | Statut services, logs admin — logs API via outil externe (D.5) |
| BO-07 | Facturation | Abonnements, revenus, churns, renouvellements |

# BO-01 — Dashboard
| BO-01 est en scope lot suivant pour les KPIs complets. En V1 : alertes actives et métriques de base. |

## KPIs
| Métrique | Calcul |
| Utilisateurs totaux | COUNT users |
| Utilisateurs actifs 30j | COUNT DISTINCT sessions.user_id WHERE last_used_at > NOW()-30d |
| Premium actifs | COUNT subscriptions WHERE status='active' AND plan='premium' |
| Transmissions actives | COUNT transmission_configs WHERE status='active' |
| Transmissions déclenchées ce mois | COUNT transmissions WHERE triggered_at > début du mois |
| Taux de check-in | % users ayant validé dernier check-in à temps |
| Revenus du mois | SUM payment_events.amount_fcfa WHERE event_type IN ('created','renewed') AND 30j |
| Tickets ouverts | COUNT support_tickets WHERE status='open' |

## Alertes (v1.1 — D.4 + D.5)
| Alerte | Criticité | Condition |
| HCV indisponible | Critique | API HCV ne répond pas > 2min |
| transmission_stalled | Haute | COUNT(transmissions expired) >= dms.relay_max_restarts (D.4) |
| Escrow expirant | Haute | escrow_expires_at < NOW() + 6h sans completion |
| Pic d'échecs questions | Haute | Plus de 3 contacts bloqués sur 1h |
| Compte verrouillé > 24h | Moyenne | Compte bloqué sans demande de déblocage |
| Storj dégradé | Basse | Alerte manuelle pour l'instant — pas de compteur |

| D.5 : Alerte 'Erreur API > seuil' supprimée — cette métrique est dans l'outil externe (Loki/Datadog), pas dans PostgreSQL. |

# BO-02 — Utilisateurs
## Liste et fiche utilisateur
| Colonne | Filtrable |
| Email | Oui |
| Nom | Oui |
| Plan (gratuit/premium) | Oui |
| Statut (actif/suspendu/supprimé) | Oui |
| Transmission (inactive/active/déclenchée) | Oui |
| Dernier check-in | Oui (plage) |
| Date création | Oui (plage) |

## Actions disponibles
| Action | Rôle requis | Précautions |
| Débloquer le compte | Support | Email auto à l'utilisateur |
| Regénérer OTP email | Support | Logger. Max 5 regénérations/heure |
| Débloquer un contact | Support | Notifier l'owner si transmission active |
| Étendre l'escrow | Admin | Max 2 extensions par transmission |
| Suspendre le compte | Admin | Email notification obligatoire |
| Changer l'email | Admin | Vérification d'identité. Logger avant/après. |
| Changer le téléphone | Admin | Même précautions que email |
| Supprimer (RGPD) | Super Admin | Irréversible. Double confirmation. Transmission annulée. |
| Renouveler abonnement | Finance, Super Admin | Logger le motif |

## Cas de support spécifiques
1. Compte bloqué
- Voir statut Bloqué + nombre de tentatives + date blocage
- Action : Débloquer → réinitialise compteur, email auto utilisateur
- Si suspect (IPs multiples) : Suspendre à la place
2. OTP non reçu
- Vérifier email_log (delivery_status via provider_id Resend)
- Action : Regénérer OTP → nouveau code valable 10 minutes
3. Contact bloqué sur transmission
- Vue : transmission ID, contact bloqué (sans nom — zero knowledge), nb tentatives
- Action : Débloquer contact → réinitialise 5 tentatives
- Admin NE PEUT PAS voir les questions ni les réponses
4. Demande RGPD
- Vérification d'identité manuelle avant suppression
- Suppression : PostgreSQL + Storj + annulation transmission
- Log minimal conservé : user_id anonymisé, date, motif. Délai max 30j.
# BO-03 — Transmissions
## Liste
| Colonne | Description |
| ID | UUID anonyme |
| Statut | En attente / Déclenchée / En cours / Complétée / Annulée / Expirée / Stalled |
| Date déclenchement | Timestamp premier email contacts |
| Contacts notifiés / confirmés | Nombres (pas les noms) |
| Schéma N-of-M | Ex: 2/3 — sans identité des contacts |
| Escrow actif | Oui/Non + TTL restant |
| Expirations | COUNT(transmissions expired) pour cette config |

## Actions
| Action | Condition | Rôle |
| Voir logs détaillés | Toujours | Support |
| Étendre TTL escrow | Escrow actif + < 2 extensions | Admin |
| Relancer notifications | Déclenchée + contacts non répondus | Admin |
| Annuler la transmission | Non encore complétée | Super Admin |
| Forcer la clôture | Expirée sans completion | Super Admin |

## Transmission stalled (D.4)
| // Condition : COUNT(transmissions WHERE status='expired' AND config_id=$1)// >= dms.relay_max_restarts (3)//// relay:cleanup ne relance plus — alerte transmission_stalled dans BO-01//// Actions admin disponibles : 1. Voir historique transmissions expirées pour cette config 2. Contacter contacts hors-bande (email dans notification_enc déchiffré) 3. Annuler transmission + notifier owner si vivant 4. Étendre escrow manuellement si transmission encore active |

# BO-04 — Questions secrètes
Bibliothèque administrée des questions proposées aux utilisateurs lors de la configuration des trusted contacts.
| L'utilisateur choisit parmi la bibliothèque — il ne peut pas créer de questions libres. Garantit un niveau de qualité minimal sur toutes les questions du système. |

## Structure d'une question
| Champ | Type | Description |
| ID | UUID | Identifiant unique |
| Texte FR | String | Libellé en français |
| Texte EN | String | Libellé en anglais |
| Catégorie | Enum | childhood / places / events / people / habits / shared_memory / other (v1.5) |
| Usage | Enum | secret_question / journal / both |
| Score fiabilité | Int 1-10 | Évaluation résistance aux erreurs et devinettes |
| Risques | Text | Notes sur risques identifiés (usage interne — Fix-11) |
| Statut | Enum | Active / Archivée / En révision |
| Nb utilisateurs | Int | Lecture seule |

## Score de fiabilité
| Score | Signification |
| 9-10 | Excellente — stable, privée, précise, non devinable |
| 7-8 | Bonne — stable et privée, légère ambiguïté possible |
| 5-6 | Acceptable — stable mais potentiellement connue d'un cercle plus large |
| 3-4 | Risquée — peut changer ou être devinable |
| 1-2 | Déconseillée — publique, instable ou ambiguë |

Seules les questions avec un score >= 6 sont proposées par défaut (vault.question_min_score configurable dans BO-05).
## Actions
| Action | Rôle |
| Ajouter une question (FR + EN, catégorie, score) | Admin |
| Modifier libellé ou score | Admin |
| Archiver (retire des propositions sans casser les usages existants) | Admin |
| Activer / Désactiver | Admin |
| Voir statistiques (nb usages, taux d'échec par catégorie) | Admin |
| Importer en lot (CSV FR/EN/catégorie/score) | Super Admin |

# BO-05 — Configuration système
| Toute modification loggée : timestamp, admin ID, valeur avant, valeur après. Modifications critiques : double confirmation requise. |

## 5.1 Dead man's switch
| Paramètre | Défaut | Description |
| dms.durations_available | [1,3,6] | Durées disponibles en mois dans l'UI |
| dms.relance_count | 3 | Nombre de relances avant déclenchement |
| dms.relance_intervals_days | [7,14,21] | Intervalles entre les relances en jours |
| dms.escrow_ttl_hours | 72 | TTL escrow en heures |
| dms.escrow_max_extensions | 2 | Max extensions admin par transmission |
| dms.pause_max_months | 3 | Durée maximum mode Pause |
| dms.relay_max_restarts | 3 | Max expirations avant alerte transmission_stalled (D.4) |

## 5.2 Sécurité
| Paramètre | Défaut | Description |
| security.pin_max_attempts | 5 | Tentatives PIN avant blocage |
| security.pin_backoff_steps | [30,120,600,1800] | Backoff progressif PIN en secondes (DEC-26) |
| security.pwd_max_attempts | 5 | Tentatives mot de passe avant blocage |
| security.session_months | 3 | Durée session avant déconnexion auto |
| security.otp_validity_min | 10 | Validité OTP email en minutes |
| security.otp_max_regen_hr | 5 | Max regénérations OTP/heure par email |
| security.contact_max_fail | 5 | Tentatives questions contact avant blocage |
| security.contact_lock_hrs | 24 | Durée blocage contact après échecs |

## 5.3 Vault et limites
| Paramètre | Défaut | Description |
| vault.free_max_accounts | 5 | Comptes max plan gratuit (contrainte côté client) |
| vault.free_max_contacts | 2 | Contacts max gratuit (minimum incompressible) |
| vault.premium_max_contacts | 5 | Contacts max premium |
| vault.max_size_mb | 50 | Taille max vault en Mo |
| vault.question_min_score | 6 | Score min pour proposer une question |
| vault.questions_per_contact | 3 | Questions à définir par contact |

## 5.5 Abonnements
| Paramètre | Défaut | Description |
| billing.premium_price_fcfa | 10000 | Prix abonnement premium annuel FCFA |
| billing.grace_period_days | 7 | Jours de grâce après expiration |
| billing.trial_days | 0 | Jours essai gratuit — 0 = désactivé (règles à définir) |

# BO-06 — Monitoring
| D.5 : GET /admin/logs/api supprimé. Les logs d'appels API sont exportés vers un outil externe (Loki, Datadog...) choisi au déploiement. Pas de table api_logs dans PostgreSQL. |

## Services surveillés
| Service | Sonde | Alerte si |
| HCV | GET {HCV_ADDR}/v1/sys/health | Indisponible > 2min — alerte service_down critique |
| PostgreSQL | SELECT 1 | Indisponible > 1min |
| Redis | PING | Indisponible |
| Storj | HEAD bucket | Dégradé — alerte manuelle pour l'instant |
| API Relais | GET /health | Uptime et dépendances HCV |

## Logs d'actions admin
Toute action dans le back office est loggée dans audit_logs (immuable — REVOKE UPDATE DELETE). Consultable depuis BO-06 avec filtres par action, admin, cible, et plage de temps.
- timestamp, admin_id, action, target_type, target_id, value_before/after, ip_hash
- Jamais de contenu de vault ni de données sensibles dans les logs
## Logs API (D.5 — export externe)
- Logs d'appels : method, path, status_code, duration_ms, user_id_hash
- Export vers Loki, Datadog, ou équivalent — choisi au déploiement
- Alertes sur taux d'erreur et latence P95 configurées dans l'outil externe
- GET /admin/logs/api supprimé de la spec — aucune table api_logs dans le schéma
# BO-07 — Facturation
## Métriques
| Métrique | Calcul |
| MRR | SUM(amount_fcfa)/12 WHERE event_type IN ('created','renewed') AND 30j (payment_events) |
| ARR | MRR × 12 |
| Abonnements actifs | COUNT subscriptions WHERE plan='premium' AND status='active' |
| Renouvellements ce mois | COUNT payment_events WHERE event_type='renewed' AND mois courant |
| Churns ce mois | COUNT payment_events WHERE event_type='expired' AND mois courant |
| En période de grâce | COUNT subscriptions WHERE status='grace' |
| Revenus cumulés | SUM(amount_fcfa) FROM payment_events WHERE event_type IN ('created','renewed') |

## Actions
| Action | Rôle |
| Accorder une extension (geste commercial) | Finance, Super Admin |
| Forcer un renouvellement manuel | Finance, Super Admin |
| Rétrograder en gratuit | Finance, Super Admin |
| Upgrader en premium manuellement | Finance, Super Admin |
| Exporter CSV abonnements et revenus | Finance, Super Admin |

| Parcours d'achat in-app : pas de fournisseur de paiement en V1. Encaissement manuel via PUT /admin/billing/:id/plan. À résoudre avant la monetisation. |

— Fin des Back Office Specs v1.1
