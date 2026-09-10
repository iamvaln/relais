RELAIS
Passe le relais, pas le chaos.
Journal des Décisions Architecture — Addendum v1.1
Addendum v1.1 — DEC-20 à DEC-27. Issues de l'analyse des points ouverts.
Avril 2026 — Confidentiel
# Addendum v1.1 — DEC-20 à DEC-27
| Ce document complète le Journal des Décisions v1.0 (DEC-01 à DEC-19). Les décisions ci-dessous font suite à l'analyse des points ouverts détectés lors de la revue croisée des specs. |

| Décision | Titre | Documents impactés |
| DEC-20 | Questions secrètes = références checkin_questions | Specs Techniques, Backend Specs, Schéma PostgreSQL |
| DEC-21 | Vault purement local — pas de table vault en PostgreSQL | Backend Specs §3.3, Schéma PostgreSQL |
| DEC-22 | silence_duration_months DEFAULT 3 | Schéma PostgreSQL |
| DEC-23 | Data recipient externe supprimé | User Stories E3-US04 |
| DEC-24 | email_log + payment_events ajoutées au schéma | Schéma PostgreSQL |
| DEC-25 | Step-up token canonique unifié | Backend Specs §2.5 |
| DEC-26 | PIN : backoff progressif | Specs Techniques §8.2, Frontend Specs §4.3, app_config |
| DEC-27 | POST /auth/seed/display (pas GET /auth/seed-words) | Backend Specs §3.1, Frontend Specs §4 |

| DEC-20 Questions secrètes = références vers checkin_questionsImpact : Specs Techniques §1,§4.3,§4.7 — Backend Specs §3.7 — Schéma trusted_contacts |

| Problème : secret_enc = XChaCha20(K2, {questions}) → le contact n'a pas K2 (appartient à l'owner décédé). Les questions ne pouvaient donc être affichées nulle part. |

| // AVANT (incorrect)secret_enc = XChaCha20(K2, { nom, rôle, questions, message })// → Contact ne peut pas lire ses questions ❌// APRÈS (DEC-20)secret_enc = XChaCha20(K2, { nom, rôle, message_personnel })question_1_id = UUID -- FK vers checkin_questions (texte public)question_2_id = UUID -- FK vers checkin_questionsquestion_3_id = UUID -- FK vers checkin_questions// Flow relay corrigé :GET /relay/:token → retourne question_1/2/3 depuis checkin_questions// Aucun déchiffrement requis pour afficher les questions ✅// Le contact voit ses questions, saisit ses réponses, K_i est dérivée// localement → déchiffrement Si_enc → part Shamir ✅ |

Justification du choix
- Option 1 (questions dans notification_enc) : Relais verrait les questions — information non nécessaire pour notifier
- Option 2 (questions = FK vers checkin_questions) : le texte est déjà public (bibliothèque admin). Relais n'apprend rien de nouveau. ✅
- Option 3 (questions dans l'email) : contredit 'aucune donnée sensible dans l'email' ❌
| DEC-21 Vault purement local — pas de table vault en PostgreSQLImpact : Backend Specs §3.3 réécrit |

| Si PostgreSQL stockait des métadonnées de vault, Relais saurait combien de comptes l'user a, quelles catégories, quand il les modifie — profil comportemental que Relais ne doit pas avoir. |

| // Endpoints SUPPRIMÉS// GET/POST/PUT/DELETE /vault/accounts → supprimés// GET /vault/summary → supprimé// Endpoints CONSERVÉS// POST /vault/sync → push P2 signé vers Storj// POST /vault/restore → pull P2 depuis Storj// GET /vault/sync-status// Limite free_max_accounts = 5 → vérifiée côté client// (count dans SQLite local) — contrainte molle acceptable en V1 |

| DEC-22 silence_duration_months DEFAULT 3Impact : Schéma transmission_configs |

| -- Cohérence avec la déconnexion pour inactivité (session_months = 3)-- Specs Techniques §7.3 : 'les 3 mois d'inactivité déclenchent-- simultanément la déconnexion et les premières relances'-- Avec DEFAULT 1, l'alignement sautait.silence_duration_months INT NOT NULL DEFAULT 3 -- (était DEFAULT 1) CHECK (silence_duration_months IN (1,3,6)) |

| DEC-23 Data recipient externe supprimé — destinataire = trusted_contactImpact : User Stories E3-US04 à corriger |

| // E3-US04 mentionnait : 'trusted contact OU une autre personne (email)'// Problème : une personne sans part Shamir ni compte Relais// ne peut pas déchiffrer les données sans que Relais voie le clair// → contradiction avec DEC-14 (transport aveugle)// Décision : le destinataire est TOUJOURS un trusted_contact// avec un rôle (has_k1/k2/k3_role)// E3-US04 à mettre à jour pour refléter cette contrainte |

| DEC-24 email_log + payment_events ajoutées au schémaImpact : Schéma PostgreSQL — tables 21 et 22 |

| -- email_log : diagnostiquer les OTP non reçus (BO-02)-- recipient_hash = SHA256(email) — jamais l'adresse en clair-- provider_id = ID Resend pour tracking délivrance-- payment_events : historique facturation pour calcul MRR/ARR (BO-07)-- subscriptions seule ne permettait que l'état courant-- payment_events garde l'historique de tous les événements-- MRR = SUM(amount_fcfa) / 12-- WHERE event_type IN ('created','renewed')-- AND created_at >= NOW() - INTERVAL '30 days' |

| DEC-25 Step-up token canonique unifiéImpact : Backend Specs §2.5 |

| // 3 versions divergentes en Backend Specs v1.0 → unifiées// Canonique :POST /auth/pin/step-upX-Step-Up-Token: <token>// Actions complètes :// edit_transmission, activate_transmission, delete_transmission,// edit_contacts, change_password, view_seed,// disable_2fa, admin_action |

| DEC-26 PIN : backoff progressifImpact : Specs Techniques §8.2, Frontend Specs §4.3, app_config |

| // E1-US03 : '30 secondes' (1 source)// Backend + BO-05 : '30 minutes' (3 sources)// Décision : backoff progressif — réconcilie les deux intentions// Tentatives 1-5 : libres// Tentative 6 : 30 secondes// Tentative 7 : 2 minutes// Tentative 8 : 10 minutes// Tentative 9+ : 30 minutes// Configurable via app_config :security.pin_backoff_steps = '[30,120,600,1800]' (array_int)// Implémenté 100% côté client (PIN ne transite jamais sur le réseau)// Le vrai rempart contre brute force = Argon2id, pas le délai |

| DEC-27 POST /auth/seed/display — pas GET /auth/seed-wordsImpact : Backend Specs §3.1, Frontend Specs §4 |

| // GET /auth/seed-words était trompeur : le serveur n'a jamais le seed// Renommé : POST /auth/seed/display// POST car c'est une action délibérée, pas une lecture passive// Step-up 'view_seed' requis// Serveur retourne : { authorized: true } — rien d'autre// L'app déchiffre seed_enc_pin localement et affiche les mots// Le seed ne transite jamais sur le réseau ✅ |

## Errata User Stories
| US | Problème | Correction |
| E3-US04 | Mentionne 'data recipient externe (email uniquement)' | Supprimer cette option. Le destinataire est toujours un trusted contact avec rôle. |
| E1-US03 | Blocage PIN : 30 secondes | Corriger : backoff progressif [30s, 2min, 10min, 30min] (DEC-26) |
| E3-US05 | 'Bimestriel' comme option de fréquence | Corriger en 'Bimensuel (toutes les 2 semaines)'. checkin_frequency_weeks IN (1,2,4) est correct. |

— Fin de l'Addendum v1.1 — DEC-20 à DEC-27
