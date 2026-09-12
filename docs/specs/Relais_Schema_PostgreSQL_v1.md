RELAIS
Passe le relais, pas le chaos.
Schéma PostgreSQL — Version 1.5
v1.5 — 23 tables + corrections D.3/D.4/E. DEC-20 à DEC-35 intégrés.
Avril 2026 — Confidentiel
# Historique des versions
| Version | Changements |
| v1.0 | 20 tables initiales |
| v1.1 | email_otp, restore_challenges, push_tokens, checkin_relances. trusted_contacts : rôles K1/K2/K3, chemins Storj par Ki. escrow : Redis. CHECK constraints. deleted_by. |
| v1.2 | question_1/2/3_id dans trusted_contacts (DEC-20). DEFAULT 3 silence_duration_months (DEC-22). email_log + payment_events (DEC-24). app_config : pin_backoff_steps (DEC-26). FK différée checkin_log→journal_entries. |
| v1.3 | checkin_questions : shared_memory + other + risk_notes (Fix-11). UNIQUE text_fr/text_en (Fix-12a). payment_events : chk_amount_required (Fix-12b). checkin_relances→email_log FK (Fix-12c). Suppression pin_lockout_min (Fix-12d). Note-01 API. |
| v1.4 | email_log : 5 types manquants + contact_designated (Point-1). two_factor_recovery_codes (Point-2). Proposals v1.5 documentées. |

# Ordre de création
| 23 tables. Respecter cet ordre pour les dépendances FK. |

| 1. admin_users2. app_config -- REFERENCES admin_users3. checkin_questions4. users5. sessions -- REFERENCES users6. email_otp -- REFERENCES users7. restore_challenges -- REFERENCES users8. push_tokens -- REFERENCES users9. subscriptions -- REFERENCES users, admin_users10. transmission_configs -- REFERENCES users11. trusted_contacts -- REFERENCES transmission_configs, users, checkin_questions(×3)12. checkin_log -- REFERENCES users, transmission_configs, checkin_questions -- journal_entry_id → FK DEFERRABLE après table 1413. checkin_relances -- REFERENCES users, transmission_configs, email_log14. journal_entries -- REFERENCES users, checkin_questions15. annual_wrappeds -- REFERENCES users16. transmissions -- REFERENCES transmission_configs, users, admin_users17. transmission_contacts -- REFERENCES transmissions, trusted_contacts18. escrow_shares -- REFERENCES transmissions, transmission_contacts19. audit_logs -- REFERENCES admin_users, users20. support_tickets -- REFERENCES users, admin_users21. email_log -- REFERENCES users22. payment_events -- REFERENCES users, subscriptions23. two_factor_recovery_codes -- REFERENCES users-- FK différée à ajouter après table 14 :ALTER TABLE checkin_log ADD CONSTRAINT fk_cl_journal FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) DEFERRABLE INITIALLY DEFERRED; |

# 1. admin_users
| admin_usersComptes back office. En premier — référencé par app_config, transmissions, subscriptions, audit_logs. |

| CREATE TABLE admin_users ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'), full_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'support' CHECK (role IN ('super_admin','admin','support','finance')), totp_secret TEXT, totp_enabled BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), login_fail_count INT NOT NULL DEFAULT 0, login_locked_until TIMESTAMPTZ, last_login_at TIMESTAMPTZ, created_by UUID REFERENCES admin_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() ); |

# 2. app_config
| app_configParamètres système. Toute modification loggée dans audit_logs. |

| CREATE TABLE app_config ( key TEXT PRIMARY KEY, value TEXT NOT NULL, config_type TEXT NOT NULL DEFAULT 'string' CHECK (config_type IN ('string','int','bool','json','array_int')), category TEXT NOT NULL CHECK (category IN ('dms','security','vault','notifications','billing')), description TEXT NOT NULL, updated_by UUID REFERENCES admin_users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );INSERT INTO app_config VALUES ('dms.durations_available', '[1,3,6]', 'array_int','dms', 'Durées DMS disponibles en mois'), ('dms.relance_count', '3', 'int', 'dms', 'Nb relances avant déclenchement'), ('dms.relance_intervals_days', '[7,14,21]', 'array_int','dms', 'Intervalles relances en jours'), ('dms.escrow_ttl_hours', '72', 'int', 'dms', 'TTL escrow en heures'), ('dms.escrow_max_extensions', '2', 'int', 'dms', 'Max extensions escrow'), ('dms.pause_max_months', '3', 'int', 'dms', 'Durée max mode pause'), ('security.pin_max_attempts', '5', 'int', 'security','Tentatives PIN avant blocage'), ('security.pin_backoff_steps', '[30,120,600,1800]','array_int','security','Backoff PIN en secondes [DEC-26]'), ('security.pwd_max_attempts', '5', 'int', 'security','Tentatives mot de passe'), ('security.session_months', '3', 'int', 'security','Durée session en mois'), ('security.otp_validity_min', '10', 'int', 'security','Validité OTP email'), ('security.otp_max_regen_hr', '5', 'int', 'security','Max regénérations OTP/h'), ('security.contact_max_fail', '5', 'int', 'security','Tentatives questions contact'), ('security.contact_lock_hrs', '24', 'int', 'security','Blocage contact en heures'), ('vault.free_max_accounts', '5', 'int', 'vault', 'Comptes max gratuit'), ('vault.free_max_contacts', '2', 'int', 'vault', 'Contacts max gratuit'), ('vault.premium_max_contacts', '5', 'int', 'vault', 'Contacts max premium'), ('vault.max_size_mb', '50', 'int', 'vault', 'Taille max vault Mo'), ('vault.question_min_score', '6', 'int', 'vault', 'Score min questions'), ('vault.questions_per_contact','3', 'int', 'vault', 'Questions par contact'), ('billing.premium_price_fcfa', '10000', 'int', 'billing', 'Prix premium FCFA/an'), ('billing.grace_period_days', '7', 'int', 'billing', 'Jours de grâce'), ('billing.trial_days', '0', 'int', 'billing', 'Jours essai gratuit'); -- ✗ security.pin_lockout_min supprimé (Fix-12d — remplacé par pin_backoff_steps) |

# 3. checkin_questions
| checkin_questionsBibliothèque admin. Questions secrètes contacts + questions carnet de vie.v1.2 : Fix-11 : shared_memory+other+risk_notes. Fix-12a : UNIQUE text_fr/text_en. |

| CREATE TABLE checkin_questions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), text_fr TEXT NOT NULL, text_en TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ( 'childhood','places','events','people','habits', 'shared_memory','other', 'month_memory','relations','work','gratitude', 'introspection','legacy','lightness' )), usage_type TEXT NOT NULL DEFAULT 'both' CHECK (usage_type IN ('secret_question','journal','both')), reliability_score INT NOT NULL DEFAULT 7 CHECK (reliability_score BETWEEN 1 AND 10), failure_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (failure_rate BETWEEN 0 AND 100), block_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (block_rate BETWEEN 0 AND 100), avg_attempts NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (avg_attempts >= 1), cycle_month INT CHECK (cycle_month BETWEEN 1 AND 12), mode_target TEXT DEFAULT 'all' CHECK (mode_target IN ('essential','reflective','all')), risk_notes TEXT, -- notes internes BO uniquement, jamais affichées aux users status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','review')), usage_count INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );-- Fix-12a : UNIQUE partiels — empêche doublons de libellé entre questions activesCREATE UNIQUE INDEX idx_cq_text_fr ON checkin_questions(text_fr) WHERE status != 'archived';CREATE UNIQUE INDEX idx_cq_text_en ON checkin_questions(text_en) WHERE status != 'archived';CREATE INDEX idx_cq_category ON checkin_questions(category);CREATE INDEX idx_cq_usage_type ON checkin_questions(usage_type);CREATE INDEX idx_cq_score ON checkin_questions(reliability_score) WHERE status = 'active' AND usage_type IN ('secret_question','both'); |

# 4. users
| usersComptes utilisateurs.v1.2 : deleted_by + deletion_reason (Point-1). pending_verification. Index partiels. |

| CREATE TABLE users ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'), phone TEXT, full_name TEXT NOT NULL, password_hash TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr','en')), -- Identité blockchain (DEC-05) ed25519_pk BYTEA UNIQUE, -- Statut email_verified BOOLEAN NOT NULL DEFAULT false, account_status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (account_status IN ('pending_verification','active','suspended','deleted')), plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')), -- 2FA totp_secret TEXT, totp_enabled BOOLEAN NOT NULL DEFAULT false, -- Sécurité login_fail_count INT NOT NULL DEFAULT 0, login_locked_until TIMESTAMPTZ, otp_fail_count INT NOT NULL DEFAULT 0, otp_locked_until TIMESTAMPTZ, -- Timestamps created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Suppression RGPD deleted_at TIMESTAMPTZ, deleted_by TEXT CHECK (deleted_by IN ('user','admin')), deleted_by_admin UUID REFERENCES admin_users(id), deletion_reason TEXT );CREATE INDEX idx_users_email ON users(email);CREATE INDEX idx_users_ed25519 ON users(ed25519_pk) WHERE ed25519_pk IS NOT NULL;CREATE INDEX idx_users_status ON users(account_status) WHERE deleted_at IS NULL;CREATE INDEX idx_users_active ON users(created_at) WHERE deleted_at IS NULL; |

# 5. sessions
| sessionsRefresh tokens actifs. |

| CREATE TABLE sessions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, refresh_token_hash TEXT NOT NULL UNIQUE CHECK (length(refresh_token_hash) = 64), device_info TEXT, ip_hash TEXT, expires_at TIMESTAMPTZ NOT NULL, last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_sessions_user ON sessions(user_id);CREATE INDEX idx_sessions_expires ON sessions(expires_at); |

# 6. email_otp
| email_otpOTP email temporaires. TTL 10min. |

| CREATE TABLE email_otp ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, email TEXT NOT NULL, otp_hash TEXT NOT NULL CHECK (length(otp_hash) = 64), purpose TEXT NOT NULL CHECK (purpose IN ('registration','email_change','password_reset')), expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0 CHECK (attempts <= 5), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_otp_email ON email_otp(email, purpose) WHERE used_at IS NULL;CREATE INDEX idx_otp_expires ON email_otp(expires_at); |

# 7. restore_challenges
| restore_challengesChallenges Ed25519 pour restauration (DEC-06). TTL 5min. |

| CREATE TABLE restore_challenges ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, challenge BYTEA NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_rc_user ON restore_challenges(user_id);CREATE INDEX idx_rc_expires ON restore_challenges(expires_at); |

# 8. push_tokens
| push_tokensTokens Expo push notifications. |

| CREATE TABLE push_tokens ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL, platform TEXT NOT NULL CHECK (platform IN ('ios','android')), active BOOLEAN NOT NULL DEFAULT true, last_used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE UNIQUE INDEX idx_pt_token ON push_tokens(token);CREATE INDEX idx_pt_user ON push_tokens(user_id) WHERE active = true; |

# 9. subscriptions
| subscriptionsAbonnements premium. |

| CREATE TABLE subscriptions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','grace','expired','cancelled')), started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ, grace_until TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, price_fcfa INT CHECK (price_fcfa > 0), currency TEXT NOT NULL DEFAULT 'XAF', auto_renew BOOLEAN NOT NULL DEFAULT true, extended_count INT NOT NULL DEFAULT 0, last_extended_by UUID REFERENCES admin_users(id), last_extended_at TIMESTAMPTZ, extension_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_sub_expires ON subscriptions(expires_at) WHERE status IN ('active','grace'); |

# 10. transmission_configs
| transmission_configsConfiguration dead man's switch.v1.2 : silence_duration_months DEFAULT 3 (DEC-22). |

| CREATE TABLE transmission_configs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','active','paused','triggered','completed')), -- DEC-22 : DEFAULT 3 aligné sur session_months silence_duration_months INT NOT NULL DEFAULT 3 CHECK (silence_duration_months IN (1,3,6)), checkin_frequency_weeks INT NOT NULL DEFAULT 4 CHECK (checkin_frequency_weeks IN (1,2,4)), schema_n INT NOT NULL DEFAULT 2 CHECK (schema_n >= 2), schema_m INT NOT NULL DEFAULT 2 CHECK (schema_m >= schema_n), storj_vault_path TEXT, arbitrum_address TEXT, contract_registered BOOLEAN NOT NULL DEFAULT false, last_checkin_at TIMESTAMPTZ, next_checkin_due TIMESTAMPTZ, relance_count INT NOT NULL DEFAULT 0 CHECK (relance_count BETWEEN 0 AND 3), last_relance_at TIMESTAMPTZ, paused_at TIMESTAMPTZ, pause_until TIMESTAMPTZ, activated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_tc_status ON transmission_configs(status);CREATE INDEX idx_tc_checkin ON transmission_configs(next_checkin_due) WHERE status = 'active'; |

# 11. trusted_contacts
| trusted_contactsContacts de confiance — deux niveaux de données (DEC-12, DEC-20).v1.2 : question_1/2/3_id (DEC-20). has_k1/k2/k3_role. Storj par Ki. Fix-06 idx_tcon_*. |

| notification_enc : crypto_box_seal(relais_x25519_pk) — DEC-28. secret_enc : {nom, rôle, message_personnel} chiffré K2, Relais ne peut pas lire. Questions = FK vers checkin_questions — DEC-20. |

| CREATE TABLE trusted_contacts ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, contact_order INT NOT NULL CHECK (contact_order >= 1), -- Niveau 1 : notification (Relais peut lire pour notifier) notification_enc BYTEA NOT NULL, -- crypto_box_seal({email,phone}, relais_x25519_pk) DEC-28 notification_sig BYTEA NOT NULL, -- Ed25519.sign(notification_enc, owner_sk) DEC-29 notification_hash TEXT NOT NULL CHECK (length(notification_hash) = 64), -- Niveau 2 : données secrètes (Relais ne peut PAS lire) secret_enc BYTEA NOT NULL, -- {nom, rôle, message_personnel} chiffré K2 -- DEC-20 : questions = références bibliothèque publique question_1_id UUID NOT NULL REFERENCES checkin_questions(id), question_2_id UUID NOT NULL REFERENCES checkin_questions(id), question_3_id UUID NOT NULL REFERENCES checkin_questions(id), CONSTRAINT chk_distinct_questions CHECK ( question_1_id <> question_2_id AND question_2_id <> question_3_id AND question_1_id <> question_3_id), -- Rôles (lisibles serveur — guide distribution Si_enc) has_k1_role BOOLEAN NOT NULL DEFAULT false, has_k2_role BOOLEAN NOT NULL DEFAULT false, has_k3_role BOOLEAN NOT NULL DEFAULT false, CONSTRAINT chk_roles CHECK (has_k1_role OR has_k2_role OR has_k3_role), -- Parts Shamir sur Storj — un chemin par Ki storj_k1_path TEXT, storj_k2_path TEXT, storj_k3_path TEXT, share_k1_hash TEXT CHECK (share_k1_hash IS NULL OR length(share_k1_hash) = 64), share_k2_hash TEXT CHECK (share_k2_hash IS NULL OR length(share_k2_hash) = 64), share_k3_hash TEXT CHECK (share_k3_hash IS NULL OR length(share_k3_hash) = 64), -- Signatures Si_enc (DEC-29) share_k1_sig BYTEA, share_k2_sig BYTEA, share_k3_sig BYTEA, -- Vérification annuelle verify_token BYTEA, verify_last_checked_at TIMESTAMPTZ, -- Statut contact_status TEXT NOT NULL DEFAULT 'active' CHECK (contact_status IN ('active','blocked','removed')), fail_count INT NOT NULL DEFAULT 0 CHECK (fail_count >= 0), blocked_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT uq_contact_order UNIQUE (transmission_id, contact_order) );-- Fix-06 : préfixe idx_tcon_ (évite collision avec idx_tc_ de transmission_configs)CREATE INDEX idx_tcon_transmission ON trusted_contacts(transmission_id);CREATE INDEX idx_tcon_user ON trusted_contacts(user_id);CREATE INDEX idx_tcon_status ON trusted_contacts(contact_status) WHERE contact_status = 'active'; |

# 12. checkin_log
| checkin_logCheck-ins validés. DEC-33 : game_type. DEC-34 : streak + badges. |

| CREATE TABLE checkin_log ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, checkin_month DATE NOT NULL, question_id UUID REFERENCES checkin_questions(id), game_type TEXT NOT NULL DEFAULT 'riddle' CHECK (game_type IN ('riddle','sequence','sort','word_search','puzzle')), game_completed_at TIMESTAMPTZ NOT NULL, attempts INT NOT NULL DEFAULT 1 CHECK (attempts >= 1), journal_entry_id UUID, -- FK DEFERRABLE ajoutée après table 14 streak_at_checkin INT NOT NULL DEFAULT 1 CHECK (streak_at_checkin >= 1), badge_earned TEXT, -- 'first_checkin'|'streak_3'|'streak_6'|'streak_12' (DEC-34) arbitrum_tx_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_cl_user_id ON checkin_log(user_id);CREATE UNIQUE INDEX idx_cl_user_month ON checkin_log(user_id, checkin_month); |

# 13. checkin_relances
| checkin_relancesHistorique relances DMS.v1.2 : Fix-12c : email_log_id FK remplace les colonnes de délivrance. |

| CREATE TABLE checkin_relances ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, relance_number INT NOT NULL CHECK (relance_number BETWEEN 1 AND 3), sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Fix-12c : source de vérité unique — plus de email_provider_id/delivery_status ici email_log_id UUID REFERENCES email_log(id) ON DELETE SET NULL );CREATE INDEX idx_cr_user ON checkin_relances(user_id);CREATE INDEX idx_cr_transmission ON checkin_relances(transmission_id); |

# 14. journal_entries
| journal_entriesCarnet de vie. Contenu chiffré K2. Signatures DEC-31. |

| CREATE TABLE journal_entries ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_id UUID REFERENCES checkin_questions(id), entry_month DATE NOT NULL, mode TEXT NOT NULL DEFAULT 'essential' CHECK (mode IN ('essential','reflective','free')), content_enc BYTEA NOT NULL, -- chiffré K2 + signé Ed25519 (DEC-31) word_count_approx INT CHECK (word_count_approx >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_je_user ON journal_entries(user_id);CREATE UNIQUE INDEX idx_je_user_month ON journal_entries(user_id, entry_month); |

# 15. annual_wrappeds
| annual_wrappedsWrapped annuels. DEC-32 : entry_count recalculé serveur.v1.2 : entry_count en clair pour BO + seuil 6 vérifiés serveur. |

| CREATE TABLE annual_wrappeds ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, year INT NOT NULL CHECK (year >= 2026), stats_enc BYTEA NOT NULL, -- chiffré K2 + signé Ed25519 (DEC-31) entry_count INT NOT NULL DEFAULT 0, -- recalculé serveur (DEC-32), jamais reçu client exported BOOLEAN NOT NULL DEFAULT false, exported_at TIMESTAMPTZ, generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE UNIQUE INDEX idx_aw_user_year ON annual_wrappeds(user_id, year); |

# 16. transmissions
| transmissionsDMS déclenchés. DEC-35 : timing corrigé. |

| CREATE TABLE transmissions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_config_id UUID NOT NULL REFERENCES transmission_configs(id), user_id UUID NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'triggered' CHECK (status IN ('triggered','in_progress','completed','cancelled','expired')), triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), escrow_expires_at TIMESTAMPTZ NOT NULL, escrow_extended_count INT NOT NULL DEFAULT 0 CHECK (escrow_extended_count <= 2), completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, arbitrum_trigger_block TEXT, schema_n_snapshot INT NOT NULL, -- snapshot au moment du déclenchement schema_m_snapshot INT NOT NULL, k1_completed BOOLEAN NOT NULL DEFAULT false, k2_completed BOOLEAN NOT NULL DEFAULT false, k3_completed BOOLEAN NOT NULL DEFAULT false, cancelled_by_admin UUID REFERENCES admin_users(id), cancellation_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_tr_config ON transmissions(transmission_config_id);CREATE INDEX idx_tr_status ON transmissions(status);CREATE INDEX idx_tr_escrow ON transmissions(escrow_expires_at) WHERE status = 'in_progress'; |

# 17. transmission_contacts
| transmission_contactsStatut par contact par transmission. |

| CREATE TABLE transmission_contacts ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_id UUID NOT NULL REFERENCES transmissions(id) ON DELETE CASCADE, trusted_contact_id UUID NOT NULL REFERENCES trusted_contacts(id), relay_token_hash TEXT NOT NULL UNIQUE CHECK (length(relay_token_hash) = 64), relay_token_expires_at TIMESTAMPTZ NOT NULL, relay_token_used BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL DEFAULT 'notified' CHECK (status IN ('notified','answered','failed','confirmed')), fail_count INT NOT NULL DEFAULT 0 CHECK (fail_count <= 5), blocked BOOLEAN NOT NULL DEFAULT false, notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), answered_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ );CREATE INDEX idx_trc_transmission ON transmission_contacts(transmission_id); |

# 18. escrow_shares
| escrow_sharesParts Si_tmp pendant reconstitution. TTL 72h. Clé éphémère Redis. |

| CREATE TABLE escrow_shares ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_id UUID NOT NULL REFERENCES transmissions(id) ON DELETE CASCADE, transmission_contact_id UUID NOT NULL REFERENCES transmission_contacts(id), key_category TEXT NOT NULL CHECK (key_category IN ('k1','k2','k3')), share_tmp_enc BYTEA NOT NULL, redis_key_id TEXT NOT NULL, -- 'escrow_key:{uuid}', TTL = expires_at expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_es_transmission ON escrow_shares(transmission_id);CREATE INDEX idx_es_expires ON escrow_shares(expires_at);CREATE UNIQUE INDEX idx_es_contact_category ON escrow_shares(transmission_contact_id, key_category); |

# 19. audit_logs
| audit_logsJournal immuable — append only. Rôle audit_writer INSERT uniquement. |

| CREATE TABLE audit_logs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id UUID REFERENCES admin_users(id), user_id UUID, action TEXT NOT NULL CHECK (action IN ( 'ACCOUNT_UNBLOCK','ACCOUNT_SUSPEND','ACCOUNT_DELETE', 'OTP_REGEN','EMAIL_CHANGE','PHONE_CHANGE','CONTACT_UNBLOCK', 'ESCROW_EXTEND','TRANSMISSION_CANCEL','TRANSMISSION_NOTIFY', 'CONFIG_UPDATE','QUESTION_ADD','QUESTION_ARCHIVE','QUESTION_UPDATE', 'SUBSCRIPTION_EXTEND','PLAN_CHANGE','ADMIN_LOGIN','ADMIN_CREATED' )), target_type TEXT CHECK (target_type IN ('user','transmission','config','question','subscription','admin')), target_id TEXT, value_before JSONB, value_after JSONB, reason TEXT, ip_hash TEXT NOT NULL, user_agent_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_al_admin_id ON audit_logs(admin_id);CREATE INDEX idx_al_user_id ON audit_logs(user_id);CREATE INDEX idx_al_action ON audit_logs(action);CREATE INDEX idx_al_created ON audit_logs(created_at);CREATE ROLE audit_writer;GRANT INSERT ON audit_logs TO audit_writer;REVOKE UPDATE, DELETE ON audit_logs FROM app_user; |

# 20. support_tickets
| support_ticketsTickets support entrants. |

| CREATE TABLE support_tickets ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), user_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('account_locked','otp_issue','transmission','subscription','rgpd','other')), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')), priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')), assigned_to UUID REFERENCES admin_users(id), resolution_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ );CREATE INDEX idx_st_status ON support_tickets(status);CREATE INDEX idx_st_priority ON support_tickets(priority, status); |

# 21. email_log
| email_logJournal délivrance emails. Source de vérité pour checkin_relances (Fix-12c).v1.2 : v1.4 : 16 types complets dont account_locked, password_changed, restore_succeeded, two_factor_enabled/disabled, contact_designated. |

| CREATE TABLE email_log ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE SET NULL, recipient_hash TEXT NOT NULL CHECK (length(recipient_hash) = 64), email_type TEXT NOT NULL CHECK (email_type IN ( -- OTP 'otp_registration','otp_email_change','otp_password_reset', -- Sécurité compte (v1.4 : manquaient en v1.3) 'account_locked','account_unblocked','account_suspended', 'password_changed','restore_succeeded', 'two_factor_enabled','two_factor_disabled', -- Transmission 'contact_designated', -- désignation à l'activation (v1.4) 'checkin_relance_1','checkin_relance_2','checkin_relance_3', 'transmission_contact', -- notification post-mortem -- Abonnements 'subscription_expiring','subscription_expired' )), provider_id TEXT, -- ID Resend status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','bounced','failed')), error_message TEXT, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );CREATE INDEX idx_el_user ON email_log(user_id);CREATE INDEX idx_el_type ON email_log(email_type, status);CREATE INDEX idx_el_sent_at ON email_log(sent_at); |

# 22. payment_events
| payment_eventsHistorique facturation. MRR/ARR calculable.v1.2 : Fix-12b : chk_amount_required — amount_fcfa NOT NULL pour created/renewed. |

| CREATE TABLE payment_events ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), subscription_id UUID NOT NULL REFERENCES subscriptions(id), event_type TEXT NOT NULL CHECK (event_type IN ( 'created','renewed','expired','cancelled', 'grace_started','admin_extended','admin_downgraded' )), amount_fcfa INT CHECK (amount_fcfa > 0), currency TEXT NOT NULL DEFAULT 'XAF', provider_ref TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Fix-12b : amount_fcfa obligatoire pour les événements de revenus CONSTRAINT chk_amount_required CHECK ( event_type NOT IN ('created','renewed') OR amount_fcfa IS NOT NULL ) );CREATE INDEX idx_pe_user ON payment_events(user_id);CREATE INDEX idx_pe_type ON payment_events(event_type, created_at);-- MRR :-- SELECT SUM(amount_fcfa)/12 AS mrr FROM payment_events-- WHERE event_type IN ('created','renewed')-- AND created_at >= NOW() - INTERVAL '30 days'; |

# 23. two_factor_recovery_codes
| two_factor_recovery_codesCodes de récupération 2FA. E6-US02. Nouveau en v1.4.v1.2 : Nouveau. |

| CREATE TABLE two_factor_recovery_codes ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash CHAR(64) NOT NULL, -- SHA256(code) — jamais le code en clair used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT uq_user_code UNIQUE (user_id, code_hash) );CREATE INDEX idx_2fa_user ON two_factor_recovery_codes(user_id) WHERE used_at IS NULL;-- 8 codes générés à l'activation 2FA-- DELETE FROM two_factor_recovery_codes WHERE user_id = $1 à la désactivation-- UPDATE SET used_at = NOW() à l'utilisation — un code ne sert qu'une fois |

# Note-01 — Validation API
| Contrainte usage_type + min_score non exprimable en CHECK PostgreSQL. Validée dans le handler POST/PUT /transmission/contacts. |

| // Valider les 3 question_id avant insertionasync function validateContactQuestions(q1id, q2id, q3id) { const questions = await db.checkin_questions.findMany({ where: { id: { in: [q1id, q2id, q3id] } } }) if (questions.length !== 3) throw new ValidationError('QUESTIONS_NOT_FOUND') const minScore = await getConfig('vault.question_min_score') // défaut 6 for (const q of questions) { if (q.usage_type === 'journal') throw new ValidationError('QUESTION_WRONG_TYPE', q.id) if (q.reliability_score < minScore) throw new ValidationError('QUESTION_SCORE_TOO_LOW', q.id) if (q.status !== 'active') throw new ValidationError('QUESTION_NOT_ACTIVE', q.id) }} |

## Proposals v1.5
| Ref | Proposition |
| Proposal-8 | share_kN_plain_hash dans trusted_contacts : SHA256(Si_brut) signé Ed25519. POST /relay/:token/verify compare avant escrow. 32 bytes par part, aucune info sur Si. |
| Proposal-9 | contact_progress email type : notifier l'autre contact (blocage E5-US02, confirmation E5-US03). Relay restart cap : max 3 expirations → alerte admin BO-03. |
| Proposal-11 | table api_logs PostgreSQL vs export Pino → Loki/Datadog. À trancher pour GET /admin/logs/api (BO-06). |

# Corrections v1.5
| D.3 : share_kN_plain_hash/sig dans trusted_contacts. D.4 : contact_progress + relay_max_restarts. E : TICKET_UPDATE dans audit_logs. |

## trusted_contacts — D.3 (plain_hash)
| -- Migration 20260912000000ALTER TABLE trusted_contacts ADD COLUMN share_k1_plain_hash CHAR(64) CHECK (share_k1_plain_hash IS NULL OR length(share_k1_plain_hash)=64), ADD COLUMN share_k2_plain_hash CHAR(64) CHECK (share_k2_plain_hash IS NULL OR length(share_k2_plain_hash)=64), ADD COLUMN share_k3_plain_hash CHAR(64) CHECK (share_k3_plain_hash IS NULL OR length(share_k3_plain_hash)=64), ADD COLUMN share_k1_plain_sig BYTEA, -- Ed25519.sign(SHA256(Si_brut), owner_sk) ADD COLUMN share_k2_plain_sig BYTEA, ADD COLUMN share_k3_plain_sig BYTEA;-- POST /relay/:token/verify compare SHA256(Si_reçu) avec share_kN_plain_hash-- Si ≠ → 422 RELAY_SHARE_INVALID, fail_count++ (D.3) |

## email_log CHECK — D.4 (contact_progress, pause_ending)
| ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_email_type_check;ALTER TABLE email_log ADD CONSTRAINT email_log_email_type_check CHECK (email_type IN ( 'otp_registration','otp_email_change','otp_password_reset', 'account_locked','account_unblocked','account_suspended', 'password_changed','restore_succeeded', 'two_factor_enabled','two_factor_disabled', 'contact_designated', 'contact_progress', -- D.4 : blocage ou confirmation d'un contact (E5-US02/03) 'checkin_relance_1','checkin_relance_2','checkin_relance_3', 'transmission_contact', 'subscription_expiring','subscription_expired', 'pause_ending' -- E4-US04 : rappel J-3 avant fin pause )); |

## app_config — D.4 (relay_max_restarts)
| INSERT INTO app_config VALUES ('dms.relay_max_restarts','3','int','dms', 'Max expirations escrow avant alerte transmission_stalled (BO-01)'); |

## audit_logs — TICKET_UPDATE (section E)
| ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (action IN ( 'ACCOUNT_UNBLOCK','ACCOUNT_SUSPEND','ACCOUNT_DELETE', 'OTP_REGEN','EMAIL_CHANGE','PHONE_CHANGE','CONTACT_UNBLOCK', 'ESCROW_EXTEND','TRANSMISSION_CANCEL','TRANSMISSION_NOTIFY', 'CONFIG_UPDATE','QUESTION_ADD','QUESTION_ARCHIVE','QUESTION_UPDATE', 'SUBSCRIPTION_EXTEND','PLAN_CHANGE','TICKET_UPDATE', 'ADMIN_LOGIN','ADMIN_CREATED' ));ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_target_type_check;ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_target_type_check CHECK (target_type IN ('user','transmission','config','question','subscription','ticket','admin')); |

— Fin du Schéma PostgreSQL v1.5 — 23 tables + corrections D.3/D.4/E
