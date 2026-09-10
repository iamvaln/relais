RELAIS
Passe le relais, pas le chaos.
Schéma PostgreSQL — Version 1.2
v1.2 — 22 tables. Corrections issues de l'audit et des points ouverts.
Avril 2026 — Confidentiel
# Changelog v1.2
| # | Changement | Table(s) concernée(s) |
| DEC-20 | Questions secrètes = 3 FK vers checkin_questions. Retirées de secret_enc. | trusted_contacts |
| DEC-21 | Vault purement local — pas de table vault en PostgreSQL. Backend §3.3 réécrit. | (aucune) |
| DEC-22 | silence_duration_months DEFAULT 3 (aligné inactivité session) | transmission_configs |
| DEC-23 | Data recipient externe supprimé — destinataire = trusted_contact avec rôle | (aucune) |
| DEC-24 | email_log + payment_events ajoutées | Nouvelles tables 21 et 22 |
| DEC-25 | Step-up token canonique : POST /auth/pin/step-up + X-Step-Up-Token | (Redis, hors schéma) |
| DEC-26 | PIN backoff progressif. app_config : security.pin_backoff_steps ajouté | app_config |
| DEC-27 | GET /auth/seed-words → POST /auth/seed/display (le serveur n'a jamais le seed) | (aucune) |
| Fix-06 | index idx_tcon_status sur trusted_contacts (évite collision avec idx_tc_status) | trusted_contacts |
| Fix-09a | FK différée checkin_log → journal_entries | checkin_log |
| Fix-09b | secret.pin_backoff_steps ajouté dans app_config | app_config |

# Ordre de création
| 22 tables. Respecter cet ordre pour les dépendances FK. |

| 1. admin_users -- aucune dépendance2. app_config -- REFERENCES admin_users3. checkin_questions -- aucune dépendance4. users -- aucune dépendance5. sessions -- REFERENCES users6. email_otp -- REFERENCES users7. restore_challenges -- REFERENCES users8. push_tokens -- REFERENCES users9. subscriptions -- REFERENCES users, admin_users10. transmission_configs -- REFERENCES users11. trusted_contacts -- REFERENCES transmission_configs, users, -- checkin_questions (×3, DEC-20)12. checkin_log -- REFERENCES users, transmission_configs, -- checkin_questions -- journal_entry_id → FK différée (Fix-09a)13. checkin_relances -- REFERENCES users, transmission_configs14. journal_entries -- REFERENCES users, checkin_questions15. annual_wrappeds -- REFERENCES users16. transmissions -- REFERENCES transmission_configs, users, admin_users17. transmission_contacts -- REFERENCES transmissions, trusted_contacts18. escrow_shares -- REFERENCES transmissions, transmission_contacts19. audit_logs -- REFERENCES admin_users, users20. support_tickets -- REFERENCES users, admin_users21. email_log -- REFERENCES users (NOUVEAU DEC-24)22. payment_events -- REFERENCES users, subscriptions (NOUVEAU DEC-24)-- FK différée à ajouter après création de journal_entries (table 14) :ALTER TABLE checkin_log ADD CONSTRAINT fk_cl_journal FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) DEFERRABLE INITIALLY DEFERRED; |

# 2. app_config — modifié
| app_configParamètres système. v1.2 : security.pin_backoff_steps ajouté (DEC-26).v1.2 : security.pin_backoff_steps ajouté |

| -- Ajout dans INSERT INTO app_config VALUES (...) ('security.pin_backoff_steps', '[30,120,600,1800]', 'array_int', 'security', 'Durées de blocage PIN progressives en secondes : 30s, 2min, 10min, 30min'),-- Mise à jour valeur par défaut silence DMS (DEC-22)UPDATE app_config SET value = '3' WHERE key = 'dms.durations_available'; -- reste [1,3,6]-- Note : silence_duration_months DEFAULT 3 dans transmission_configs-- correspond au 3ème mois dans durations_available — cohérent. |

# 10. transmission_configs — modifié
| transmission_configsConfig DMS. v1.2 : silence_duration_months DEFAULT 3 (DEC-22).v1.2 : DEFAULT 3 au lieu de DEFAULT 1 |

| CREATE TABLE transmission_configs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ( 'inactive','active','paused','triggered','completed' )), -- DEC-22 : DEFAULT 3 (aligné sur inactivité session 3 mois) silence_duration_months INT NOT NULL DEFAULT 3 CHECK (silence_duration_months IN (1,3,6)), checkin_frequency_weeks INT NOT NULL DEFAULT 4 CHECK (checkin_frequency_weeks IN (1,2,4)), schema_n INT NOT NULL DEFAULT 2 CHECK (schema_n >= 2), schema_m INT NOT NULL DEFAULT 2 CHECK (schema_m >= schema_n), storj_vault_path TEXT, arbitrum_address TEXT, contract_registered BOOLEAN NOT NULL DEFAULT false, last_checkin_at TIMESTAMPTZ, next_checkin_due TIMESTAMPTZ, relance_count INT NOT NULL DEFAULT 0 CHECK (relance_count BETWEEN 0 AND 3), last_relance_at TIMESTAMPTZ, paused_at TIMESTAMPTZ, pause_until TIMESTAMPTZ, activated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_tc_status ON transmission_configs(status);CREATE INDEX idx_tc_checkin ON transmission_configs(next_checkin_due) WHERE status = 'active'; |

# 11. trusted_contacts — modifié
| trusted_contactsContacts de confiance. v1.2 : 3 FK vers checkin_questions (DEC-20). Questions retirées de secret_enc. Index renommé (Fix-06).v1.2 : question_1/2/3_id ajoutés. secret_enc = {nom, rôle, message_personnel} uniquement. |

| DEC-20 : Les questions secrètes sont des références vers checkin_questions. Le texte est public (bibliothèque admin). Le contact voit les questions depuis l'API /relay/:token sans déchiffrer quoi que ce soit. secret_enc ne contient plus les questions. |

| CREATE TABLE trusted_contacts ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, contact_order INT NOT NULL CHECK (contact_order >= 1), -- NIVEAU 1 : données de notification (Relais peut lire pour notifier) notification_enc BYTEA NOT NULL, notification_sig BYTEA NOT NULL, notification_hash TEXT NOT NULL CHECK (length(notification_hash) = 64), -- NIVEAU 2 : données secrètes (Relais ne peut PAS lire) -- v1.2 : secret_enc = { nom, rôle, message_personnel } UNIQUEMENT -- Les questions sont dans question_1/2/3_id (DEC-20) secret_enc BYTEA NOT NULL, -- DEC-20 : Questions secrètes = références bibliothèque (texte public) question_1_id UUID NOT NULL REFERENCES checkin_questions(id), question_2_id UUID NOT NULL REFERENCES checkin_questions(id), question_3_id UUID NOT NULL REFERENCES checkin_questions(id), -- Contrainte : les 3 questions doivent être distinctes CONSTRAINT chk_distinct_questions CHECK (question_1_id <> question_2_id AND question_2_id <> question_3_id AND question_1_id <> question_3_id), -- Contrainte : uniquement des questions de type secret_question ou both -- (vérifié en application — pas de CHECK sur sous-select en PG standard) -- Rôles (lisibles par le serveur) has_k1_role BOOLEAN NOT NULL DEFAULT false, has_k2_role BOOLEAN NOT NULL DEFAULT false, has_k3_role BOOLEAN NOT NULL DEFAULT false, CONSTRAINT chk_roles CHECK (has_k1_role OR has_k2_role OR has_k3_role), -- Parts Shamir sur Storj storj_k1_path TEXT, storj_k2_path TEXT, storj_k3_path TEXT, share_k1_hash TEXT CHECK (share_k1_hash IS NULL OR length(share_k1_hash) = 64), share_k2_hash TEXT CHECK (share_k2_hash IS NULL OR length(share_k2_hash) = 64), share_k3_hash TEXT CHECK (share_k3_hash IS NULL OR length(share_k3_hash) = 64), -- Vérification annuelle verify_token BYTEA, verify_last_checked_at TIMESTAMPTZ, -- Statut contact_status TEXT NOT NULL DEFAULT 'active' CHECK (contact_status IN ('active','blocked','removed')), fail_count INT NOT NULL DEFAULT 0 CHECK (fail_count >= 0), blocked_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT uq_contact_order UNIQUE (transmission_id, contact_order));CREATE INDEX idx_tcon_transmission ON trusted_contacts(transmission_id);CREATE INDEX idx_tcon_user ON trusted_contacts(user_id);-- Fix-06 : renommé idx_tcon_status (évite collision avec idx_tc_status)CREATE INDEX idx_tcon_status ON trusted_contacts(contact_status) WHERE contact_status = 'active'; |

# 12. checkin_log — FK différée
| checkin_logv1.2 : FK différée vers journal_entries ajoutée en fin de migration (Fix-09a).v1.2 : FK différée journal_entry_id → journal_entries |

| -- Table inchangée par rapport à v1.1-- FK différée à exécuter APRÈS CREATE TABLE journal_entries (table 14) :ALTER TABLE checkin_log ADD CONSTRAINT fk_cl_journal FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) DEFERRABLE INITIALLY DEFERRED;-- DEFERRABLE INITIALLY DEFERRED : la contrainte est vérifiée-- à la fin de la transaction, pas à chaque INSERT.-- Permet d'insérer checkin_log avant journal_entries dans la même tx. |

# 21. email_log — NOUVEAU
| email_logJournal de délivrance des emails. Nouveau en v1.2 (DEC-24). Permet au support de diagnostiquer les OTP non reçus (BO-02).v1.2 : Nouveau |

| CREATE TABLE email_log ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- SET NULL : conserver le log même si user supprimé recipient_hash TEXT NOT NULL CHECK (length(recipient_hash) = 64), -- SHA256(email) — jamais l'adresse en clair email_type TEXT NOT NULL CHECK (email_type IN ( 'otp_registration', 'otp_email_change', 'otp_password_reset', 'checkin_relance_1', 'checkin_relance_2', 'checkin_relance_3', 'transmission_contact', 'account_suspended', 'account_unblocked', 'subscription_expiring', 'subscription_expired' )), provider_id TEXT, -- ID Resend pour tracking délivrance status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','bounced','failed')), error_message TEXT, -- NULL si succès, message d'erreur sinon sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_el_user ON email_log(user_id);CREATE INDEX idx_el_type ON email_log(email_type, status);CREATE INDEX idx_el_sent_at ON email_log(sent_at);-- Rétention : logs conservés 90 jours puis archivés |

# 22. payment_events — NOUVEAU
| payment_eventsHistorique des événements de facturation. Nouveau en v1.2 (DEC-24). Permet le calcul MRR/ARR (BO-07).v1.2 : Nouveau |

| CREATE TABLE payment_events ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), subscription_id UUID NOT NULL REFERENCES subscriptions(id), event_type TEXT NOT NULL CHECK (event_type IN ( 'created', -- premier abonnement 'renewed', -- renouvellement 'expired', -- expiration sans renouvellement 'cancelled', -- résiliation volontaire 'grace_started', -- entrée en période de grâce 'admin_extended', -- extension manuelle admin 'admin_downgraded' -- rétrogradation admin )), amount_fcfa INT CHECK (amount_fcfa > 0), -- NULL si pas de paiement (expiration, annulation) currency TEXT NOT NULL DEFAULT 'XAF', provider_ref TEXT, -- référence paiement mobile money / carte notes TEXT, -- motif admin si admin_extended / admin_downgraded created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_pe_user ON payment_events(user_id);CREATE INDEX idx_pe_type ON payment_events(event_type, created_at);-- Calcul MRR (exemple) :-- SELECT SUM(amount_fcfa) / 12 AS mrr_fcfa-- FROM payment_events-- WHERE event_type IN ('created','renewed')-- AND created_at >= NOW() - INTERVAL '30 days'; |

— Fin du Schéma PostgreSQL v1.2 — 22 tables — DEC-20 à DEC-27 intégrées
