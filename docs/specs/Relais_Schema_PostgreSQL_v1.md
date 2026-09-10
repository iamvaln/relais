RELAIS
Passe le relais, pas le chaos.
Schéma PostgreSQL — Version 1.1
Avril 2026 — Confidentiel
v1.1 : email_otp, restore_challenges, push_tokens, checkin_relances ajoutés. trusted_contacts : rôles K1/K2/K3 et chemins Storj par catégorie. escrow : clé Redis explicitée. CHECK constraints sur tous les enums. deleted_by + deletion_reason sur users. audit_writer role.
# Introduction
Schéma complet de la base de données PostgreSQL de Relais. Cohérent avec les décisions DEC-01 à DEC-19 et le retour d'audit v1.0.
| Principe zero-knowledge : PostgreSQL ne contient jamais de données déchiffrées. Les Si_enc (parts Shamir) sont sur Storj. Seuls les hashes sont on-chain Arbitrum. relais_private_key est dans HCV Secrets Engine. |

## Ordre de création des tables
| L'ordre ci-dessous respecte les dépendances de clés étrangères. Toujours exécuter dans cet ordre. |

| -- Ordre de création (v1.1 — dépendances résolues)1. admin_users -- aucune dépendance2. app_config -- REFERENCES admin_users3. checkin_questions -- aucune dépendance4. users -- aucune dépendance5. sessions -- REFERENCES users6. email_otp -- REFERENCES users7. restore_challenges -- REFERENCES users8. push_tokens -- REFERENCES users9. subscriptions -- REFERENCES users, admin_users10. transmission_configs -- REFERENCES users11. trusted_contacts -- REFERENCES transmission_configs, users12. checkin_log -- REFERENCES users, transmission_configs, checkin_questions13. checkin_relances -- REFERENCES users, transmission_configs14. journal_entries -- REFERENCES users, checkin_questions15. annual_wrappeds -- REFERENCES users16. transmissions -- REFERENCES transmission_configs, users, admin_users17. transmission_contacts -- REFERENCES transmissions, trusted_contacts18. escrow_shares -- REFERENCES transmissions, transmission_contacts19. audit_logs -- REFERENCES admin_users, users20. support_tickets -- REFERENCES users, admin_users |

## Tables — vue d'ensemble
| # | Table | Domaine | Lignes V1 estimées |
| 1 | admin_users | Back office | < 10 |
| 2 | app_config | Configuration système | ~25 lignes |
| 3 | checkin_questions | Bibliothèque questions | 50-200 |
| 4 | users | Comptes utilisateurs | 1 000-10 000 |
| 5 | sessions | Sessions actives | 1-5 par user |
| 6 | email_otp | OTP email temporaires | Faible — TTL 10min |
| 7 | restore_challenges | Challenges restauration Ed25519 | Très faible — TTL 5min |
| 8 | push_tokens | Tokens push notifications | 1-3 par user |
| 9 | subscriptions | Abonnements premium | 1 par user premium |
| 10 | transmission_configs | Configuration dead man's switch | 1 par user actif |
| 11 | trusted_contacts | Contacts de confiance | 2-5 par transmission |
| 12 | checkin_log | Check-ins validés | 12 par user par an |
| 13 | checkin_relances | Historique relances DMS | 1-3 par check-in manqué |
| 14 | journal_entries | Carnet de vie chiffré | 1 par mois par user |
| 15 | annual_wrappeds | Wrapped annuels | 1 par an par user actif |
| 16 | transmissions | DMS déclenchés | Rare — quelques/mois |
| 17 | transmission_contacts | Statut contact par transmission | N par transmission |
| 18 | escrow_shares | Parts Si_tmp (TTL 72h) | Temporaire |
| 19 | audit_logs | Actions admin immuables | Croissance continue |
| 20 | support_tickets | Tickets support | Variable |

# 1. admin_users
| admin_usersComptes back office. En premier — référencé par app_config, transmissions, subscriptions, audit_logs. |

| CREATE TABLE admin_users ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'), full_name TEXT NOT NULL, password_hash TEXT NOT NULL, -- Argon2id role TEXT NOT NULL DEFAULT 'support' CHECK (role IN ('super_admin','admin','support','finance')), totp_secret TEXT, -- secret TOTP en clair (standard TOTP) -- NULL jusqu'à l'activation totp_enabled BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), login_fail_count INT NOT NULL DEFAULT 0, login_locked_until TIMESTAMPTZ, last_login_at TIMESTAMPTZ, created_by UUID REFERENCES admin_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); |

# 2. app_config
| app_configParamètres système configurables depuis le back office. Toute modification est loggée dans audit_logs. |

| CREATE TABLE app_config ( key TEXT PRIMARY KEY, value TEXT NOT NULL, config_type TEXT NOT NULL DEFAULT 'string' CHECK (config_type IN ('string','int','bool','json','array_int')), category TEXT NOT NULL CHECK (category IN ('dms','security','vault','notifications','billing')), description TEXT NOT NULL, updated_by UUID REFERENCES admin_users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());INSERT INTO app_config VALUES ('dms.durations_available', '[1,3,6]', 'array_int','dms', 'Durées DMS disponibles en mois'), ('dms.relance_count', '3', 'int', 'dms', 'Nb relances avant déclenchement'), ('dms.relance_intervals_days', '[7,14,21]', 'array_int','dms', 'Intervalles relances en jours'), ('dms.escrow_ttl_hours', '72', 'int', 'dms', 'TTL escrow en heures'), ('dms.escrow_max_extensions', '2', 'int', 'dms', 'Max extensions escrow par transmission'), ('dms.pause_max_months', '3', 'int', 'dms', 'Durée max mode pause'), ('security.pin_max_attempts', '5', 'int', 'security','Tentatives PIN avant blocage'), ('security.pin_lockout_min', '30', 'int', 'security','Durée blocage PIN en minutes'), ('security.pwd_max_attempts', '5', 'int', 'security','Tentatives mot de passe avant blocage'), ('security.session_months', '3', 'int', 'security','Durée de vie session en mois'), ('security.otp_validity_min', '10', 'int', 'security','Validité OTP email en minutes'), ('security.otp_max_regen_hr', '5', 'int', 'security','Max regénérations OTP par heure'), ('security.contact_max_fail', '5', 'int', 'security','Tentatives questions contact avant blocage'), ('security.contact_lock_hrs', '24', 'int', 'security','Durée blocage contact en heures'), ('vault.free_max_accounts', '5', 'int', 'vault', 'Comptes max plan gratuit'), ('vault.free_max_contacts', '2', 'int', 'vault', 'Contacts max plan gratuit (incompressible)'), ('vault.premium_max_contacts', '5', 'int', 'vault', 'Contacts max plan premium'), ('vault.max_size_mb', '50', 'int', 'vault', 'Taille max vault en Mo'), ('vault.question_min_score', '6', 'int', 'vault', 'Score min questions proposées aux users'), ('vault.questions_per_contact','3', 'int', 'vault', 'Nb questions requises par contact'), ('billing.premium_price_fcfa', '10000', 'int', 'billing', 'Prix abonnement premium annuel en FCFA'), ('billing.grace_period_days', '7', 'int', 'billing', 'Jours de grâce après expiration'), ('billing.trial_days', '0', 'int', 'billing', 'Jours essai gratuit (0 = désactivé)'); |

# 3. checkin_questions
| checkin_questionsBibliothèque admin de questions. Deux usages : questions secrètes contacts et questions du carnet de vie. |

| CREATE TABLE checkin_questions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), text_fr TEXT NOT NULL, text_en TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ( 'childhood','places','events','people','habits', 'month_memory','relations','work','gratitude', 'introspection','legacy','lightness' )), usage_type TEXT NOT NULL DEFAULT 'both' CHECK (usage_type IN ('secret_question','journal','both')), -- Scoring (questions secrètes uniquement) reliability_score INT NOT NULL DEFAULT 7 CHECK (reliability_score BETWEEN 1 AND 10), failure_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (failure_rate BETWEEN 0 AND 100), block_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (block_rate BETWEEN 0 AND 100), avg_attempts NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (avg_attempts >= 1), -- Cycle annuel (carnet de vie uniquement) cycle_month INT CHECK (cycle_month BETWEEN 1 AND 12), mode_target TEXT DEFAULT 'all' CHECK (mode_target IN ('essential','reflective','all')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','review')), usage_count INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_cq_category ON checkin_questions(category);CREATE INDEX idx_cq_usage_type ON checkin_questions(usage_type);CREATE INDEX idx_cq_status ON checkin_questions(status);CREATE INDEX idx_cq_score ON checkin_questions(reliability_score) WHERE status = 'active' AND usage_type IN ('secret_question','both');CREATE INDEX idx_cq_cycle ON checkin_questions(cycle_month) WHERE usage_type IN ('journal','both') AND status = 'active'; |

# 4. users
| usersComptes utilisateurs. Source d'identité principale.v1.1 : deleted_by + deletion_reason ajoutés. CHECK constraints sur enums. Index partiel WHERE deleted_at IS NULL. |

| CREATE TABLE users ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'), phone TEXT, full_name TEXT NOT NULL, password_hash TEXT NOT NULL, -- Argon2id(password) language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr','en')), -- Identité blockchain (DEC-05) ed25519_pk BYTEA UNIQUE, -- clé publique dérivée du seed -- NULL jusqu'à la complétion onboarding -- Statut email_verified BOOLEAN NOT NULL DEFAULT false, account_status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (account_status IN ( 'pending_verification','active','suspended','deleted' )), plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')), -- 2FA totp_secret TEXT, -- secret TOTP (standard TOTP — stocké en clair côté serveur) totp_enabled BOOLEAN NOT NULL DEFAULT false, -- Sécurité — compteurs d'échecs login_fail_count INT NOT NULL DEFAULT 0, login_locked_until TIMESTAMPTZ, otp_fail_count INT NOT NULL DEFAULT 0, otp_locked_until TIMESTAMPTZ, -- Timestamps created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Suppression RGPD (v1.1 : deleted_by + deletion_reason ajoutés) deleted_at TIMESTAMPTZ, deleted_by TEXT CHECK (deleted_by IN ('user','admin')), deleted_by_admin UUID REFERENCES admin_users(id), deletion_reason TEXT -- motif admin ou 'user_request' si self-delete);CREATE INDEX idx_users_email ON users(email);CREATE INDEX idx_users_ed25519 ON users(ed25519_pk) WHERE ed25519_pk IS NOT NULL;CREATE INDEX idx_users_status ON users(account_status) WHERE deleted_at IS NULL;CREATE INDEX idx_users_active ON users(created_at) WHERE deleted_at IS NULL; |

# 5. sessions
| sessionsRefresh tokens actifs. Un par device. |

| CREATE TABLE sessions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, refresh_token_hash TEXT NOT NULL UNIQUE, -- HMAC-SHA256(token, server_secret) — longueur fixe 64 hex CHECK (length(refresh_token_hash) = 64), device_info TEXT, -- user-agent tronqué (< 200 chars) ip_hash TEXT, -- SHA256(IP) pour audit — jamais IP en clair expires_at TIMESTAMPTZ NOT NULL, -- NOW() + 90 jours last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_sessions_user ON sessions(user_id);CREATE INDEX idx_sessions_expires ON sessions(expires_at);-- Job BullMQ quotidien : DELETE FROM sessions WHERE expires_at < NOW(); |

# 6. email_otp
| email_otpOTP email temporaires. Nouveau en v1.1 — manquait dans v1.0.v1.1 : Nouveau. Couvre registration, email_change, password_reset. |

| CREATE TABLE email_otp ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL si user non encore créé (registration) email TEXT NOT NULL, otp_hash TEXT NOT NULL, -- SHA256(otp_code) — jamais le code en clair CHECK (length(otp_hash) = 64), purpose TEXT NOT NULL CHECK (purpose IN ( 'registration','email_change','password_reset' )), expires_at TIMESTAMPTZ NOT NULL, -- NOW() + 10 minutes used_at TIMESTAMPTZ, -- NULL si pas encore utilisé attempts INT NOT NULL DEFAULT 0 CHECK (attempts <= 5), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_otp_email ON email_otp(email, purpose) WHERE used_at IS NULL;CREATE INDEX idx_otp_expires ON email_otp(expires_at);-- Job BullMQ horaire : DELETE FROM email_otp WHERE expires_at < NOW();-- Note : max 5 OTP actifs par heure par email contrôlé en application-- (app_config: security.otp_max_regen_hr = 5) |

# 7. restore_challenges
| restore_challengesChallenges Ed25519 temporaires pour vérification du seed à la restauration. Nouveau en v1.1.v1.1 : Nouveau. Couvre DEC-06 challenge-response. |

| CREATE TABLE restore_challenges ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, challenge BYTEA NOT NULL, -- 32 bytes aléatoires expires_at TIMESTAMPTZ NOT NULL, -- NOW() + 5 minutes used BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_rc_user_id ON restore_challenges(user_id);CREATE INDEX idx_rc_expires ON restore_challenges(expires_at);-- Job BullMQ : DELETE FROM restore_challenges WHERE expires_at < NOW() OR used = true;-- Flow :-- GET /auth/restore/challenge → INSERT challenge, retourne challenge bytes-- POST /auth/restore/verify → Ed25519.verify(signature, challenge, ed25519_pk)-- → UPDATE used = true si valide |

# 8. push_tokens
| push_tokensTokens push Expo pour notifications de check-in. Nouveau en v1.1.v1.1 : Nouveau. |

| CREATE TABLE push_tokens ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL, -- Ex: ExponentPushToken[xxxxxx] platform TEXT NOT NULL CHECK (platform IN ('ios','android')), active BOOLEAN NOT NULL DEFAULT true, last_used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE UNIQUE INDEX idx_pt_token ON push_tokens(token);CREATE INDEX idx_pt_user ON push_tokens(user_id) WHERE active = true; |

# 9. subscriptions
| subscriptionsAbonnements premium. Un par utilisateur. |

| CREATE TABLE subscriptions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','grace','expired','cancelled')), started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ, -- NULL si plan free grace_until TIMESTAMPTZ, -- expires_at + grace_period_days cancelled_at TIMESTAMPTZ, price_fcfa INT CHECK (price_fcfa > 0), currency TEXT NOT NULL DEFAULT 'XAF', auto_renew BOOLEAN NOT NULL DEFAULT true, -- Historique extensions admin extended_count INT NOT NULL DEFAULT 0, last_extended_by UUID REFERENCES admin_users(id), last_extended_at TIMESTAMPTZ, extension_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_sub_expires ON subscriptions(expires_at) WHERE status IN ('active','grace'); |

# 10. transmission_configs
| transmission_configsConfiguration dead man's switch. |

| CREATE TABLE transmission_configs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ( 'inactive','active','paused','triggered','completed' )), silence_duration_months INT NOT NULL DEFAULT 1 CHECK (silence_duration_months IN (1,3,6)), checkin_frequency_weeks INT NOT NULL DEFAULT 4 CHECK (checkin_frequency_weeks IN (1,2,4)), schema_n INT NOT NULL DEFAULT 2 CHECK (schema_n >= 2), schema_m INT NOT NULL DEFAULT 2 CHECK (schema_m >= schema_n), -- Storj vault pointer storj_vault_path TEXT, -- ex: 'payloads/{user_id}/' -- Blockchain arbitrum_address TEXT, contract_registered BOOLEAN NOT NULL DEFAULT false, -- Check-in last_checkin_at TIMESTAMPTZ, next_checkin_due TIMESTAMPTZ, relance_count INT NOT NULL DEFAULT 0 CHECK (relance_count BETWEEN 0 AND 3), last_relance_at TIMESTAMPTZ, -- Mode pause paused_at TIMESTAMPTZ, pause_until TIMESTAMPTZ, -- Timestamps activated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_tc_status ON transmission_configs(status);CREATE INDEX idx_tc_checkin ON transmission_configs(next_checkin_due) WHERE status = 'active'; -- index partiel : seulement les transmissions actives |

# 11. trusted_contacts
| trusted_contactsContacts de confiance avec deux niveaux de données (DEC-12).v1.1 : v1.1 : has_k1/k2/k3_role ajoutés. storj_share_path éclaté en 3 chemins par Ki. CHECK sur contact_status. |

| notification_enc : chiffré avec relais_public_key — Relais peut lire pour notifier. notification_sig : signature Ed25519 owner — protège contre toute modification. secret_enc : chiffré K2 — Relais ne peut pas lire. Les Si_enc sont sur Storj, jamais en PostgreSQL. |

| CREATE TABLE trusted_contacts ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, contact_order INT NOT NULL CHECK (contact_order >= 1), -- NIVEAU 1 : données de notification (Relais peut lire pour notifier) notification_enc BYTEA NOT NULL, notification_sig BYTEA NOT NULL, -- Ed25519.sign(notification_enc, owner_sk) notification_hash TEXT NOT NULL, -- SHA256(notification_enc || notification_sig) hex CHECK (length(notification_hash) = 64), -- NIVEAU 2 : données secrètes (Relais ne peut PAS lire) secret_enc BYTEA NOT NULL, -- {nom,rôle,questions,message} chiffré K2 -- Rôles (lisibles par le serveur — le nom du rôle reste dans secret_enc) -- Nécessaire pour savoir quels Si_enc distribuer lors du déclenchement has_k1_role BOOLEAN NOT NULL DEFAULT false, -- Gestionnaire pratique has_k2_role BOOLEAN NOT NULL DEFAULT false, -- Gardien du souvenir has_k3_role BOOLEAN NOT NULL DEFAULT false, -- Exécuteur financier -- Parts Shamir sur Storj — un chemin par catégorie de clé (v1.1) -- NULL si le contact n'a pas ce rôle storj_k1_path TEXT, -- chemin Storj Si_enc pour K1 storj_k2_path TEXT, storj_k3_path TEXT, -- Hashes on-chain (copie locale du hash Arbitrum) share_k1_hash TEXT, CHECK (share_k1_hash IS NULL OR length(share_k1_hash) = 64), share_k2_hash TEXT, CHECK (share_k2_hash IS NULL OR length(share_k2_hash) = 64), share_k3_hash TEXT, CHECK (share_k3_hash IS NULL OR length(share_k3_hash) = 64), -- Vérification annuelle des réponses (DEC-07) verify_token BYTEA, -- XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1') ~40 bytes verify_last_checked_at TIMESTAMPTZ, -- Statut contact_status TEXT NOT NULL DEFAULT 'active' CHECK (contact_status IN ('active','blocked','removed')), fail_count INT NOT NULL DEFAULT 0 CHECK (fail_count >= 0), blocked_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT uq_contact_order UNIQUE (transmission_id, contact_order), CONSTRAINT chk_roles CHECK (has_k1_role OR has_k2_role OR has_k3_role));CREATE INDEX idx_tc_transmission ON trusted_contacts(transmission_id);CREATE INDEX idx_tc_user ON trusted_contacts(user_id);CREATE INDEX idx_tc_status ON trusted_contacts(contact_status) WHERE contact_status = 'active'; |

# 12. checkin_log
| checkin_logHistorique des check-ins validés. |

| CREATE TABLE checkin_log ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, checkin_month DATE NOT NULL, question_id UUID REFERENCES checkin_questions(id), game_type TEXT NOT NULL DEFAULT 'riddle' CHECK (game_type IN ( 'riddle','sequence','sort','word_search','puzzle' )), game_completed_at TIMESTAMPTZ NOT NULL, attempts INT NOT NULL DEFAULT 1 CHECK (attempts >= 1), journal_entry_id UUID, -- lié à journal_entries si réponse donnée streak_at_checkin INT NOT NULL DEFAULT 1 CHECK (streak_at_checkin >= 1), badge_earned TEXT, arbitrum_tx_hash TEXT, -- hash tx checkin() on-chain Arbitrum created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_cl_user_id ON checkin_log(user_id);CREATE INDEX idx_cl_month ON checkin_log(checkin_month);CREATE UNIQUE INDEX idx_cl_user_month ON checkin_log(user_id, checkin_month); |

# 13. checkin_relances
| checkin_relancesHistorique des relances DMS envoyées. Nouveau en v1.1.v1.1 : Nouveau. Traçabilité des 3 relances par check-in manqué. |

| CREATE TABLE checkin_relances ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, relance_number INT NOT NULL CHECK (relance_number BETWEEN 1 AND 3), sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), email_provider_id TEXT, -- ID Resend pour tracking délivrance delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent','delivered','bounced','failed')));CREATE INDEX idx_cr_user ON checkin_relances(user_id);CREATE INDEX idx_cr_transmission ON checkin_relances(transmission_id); |

# 14. journal_entries
| journal_entriesEntrées du carnet de vie. Contenu chiffré avec K2.v1.1 : v1.1 : sync_status retiré (géré côté client dans SQLite local). |

| sync_status retiré de v1.0. La sync du journal fait partie du vault P2 global. La source de vérité de synchronisation est la base SQLite locale (frontend specs section 6). |

| CREATE TABLE journal_entries ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_id UUID REFERENCES checkin_questions(id), entry_month DATE NOT NULL, mode TEXT NOT NULL DEFAULT 'essential' CHECK (mode IN ('essential','reflective','free')), content_enc BYTEA NOT NULL, -- chiffré K2 — Relais ne peut pas lire word_count_approx INT CHECK (word_count_approx >= 0), -- calculé localement avant chiffrement -- pour stats Wrapped sans déchiffrer created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_je_user ON journal_entries(user_id);CREATE INDEX idx_je_month ON journal_entries(entry_month);CREATE UNIQUE INDEX idx_je_user_month ON journal_entries(user_id, entry_month); |

# 15. annual_wrappeds
| annual_wrappedsWrapped annuels. Stats chiffrées K2 + entry_count en clair.v1.1 : v1.1 : entry_count en clair ajouté pour monitoring back office sans déchiffrer. |

| CREATE TABLE annual_wrappeds ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, year INT NOT NULL CHECK (year >= 2026), stats_enc BYTEA NOT NULL, -- {entries_count, max_streak, -- dominant_themes, most_used_word, -- richest_month, total_words, -- badges_earned[]} chiffré K2 entry_count INT NOT NULL DEFAULT 0, -- en clair pour back office exported BOOLEAN NOT NULL DEFAULT false, exported_at TIMESTAMPTZ, generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE UNIQUE INDEX idx_aw_user_year ON annual_wrappeds(user_id, year); |

# 16. transmissions
| transmissionsDead man's switch déclenchés. Un enregistrement par activation. |

| CREATE TABLE transmissions ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_config_id UUID NOT NULL REFERENCES transmission_configs(id), user_id UUID NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'triggered' CHECK (status IN ( 'triggered','in_progress','completed', 'cancelled','expired' )), -- Timing triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), escrow_expires_at TIMESTAMPTZ NOT NULL, -- triggered_at + escrow_ttl_hours (depuis app_config) escrow_extended_count INT NOT NULL DEFAULT 0 CHECK (escrow_extended_count <= 2), completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, -- Blockchain arbitrum_trigger_block TEXT, -- Snapshot N-of-M au moment du déclenchement schema_n_snapshot INT NOT NULL, schema_m_snapshot INT NOT NULL, -- Progression par catégorie k1_completed BOOLEAN NOT NULL DEFAULT false, k2_completed BOOLEAN NOT NULL DEFAULT false, k3_completed BOOLEAN NOT NULL DEFAULT false, -- Admin cancelled_by_admin UUID REFERENCES admin_users(id), cancellation_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_tr_config ON transmissions(transmission_config_id);CREATE INDEX idx_tr_status ON transmissions(status);CREATE INDEX idx_tr_escrow ON transmissions(escrow_expires_at) WHERE status = 'in_progress'; |

# 17. transmission_contacts
| transmission_contactsStatut de chaque contact pour une transmission. |

| CREATE TABLE transmission_contacts ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_id UUID NOT NULL REFERENCES transmissions(id) ON DELETE CASCADE, trusted_contact_id UUID NOT NULL REFERENCES trusted_contacts(id), relay_token_hash TEXT NOT NULL UNIQUE, -- HMAC-SHA256(token, server_secret) CHECK (length(relay_token_hash) = 64), relay_token_expires_at TIMESTAMPTZ NOT NULL, relay_token_used BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL DEFAULT 'notified' CHECK (status IN ('notified','answered','failed','confirmed')), fail_count INT NOT NULL DEFAULT 0 CHECK (fail_count <= 5), blocked BOOLEAN NOT NULL DEFAULT false, notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), answered_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ);CREATE INDEX idx_trc_transmission ON transmission_contacts(transmission_id);CREATE INDEX idx_trc_status ON transmission_contacts(status); |

# 18. escrow_shares
| escrow_sharesParts Si_tmp pendant la reconstitution. TTL 72h.v1.1 : v1.1 : redis_key_id documenté — clé éphémère Redis, pas HCV. |

| Les Si_enc permanents sont sur Storj. L'escrow contient uniquement les parts déchiffrées et re-chiffrées avec une clé Redis éphémère, le temps que N contacts aient répondu. La clé Redis expire simultanément avec escrow_expires_at. |

| CREATE TABLE escrow_shares ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), transmission_id UUID NOT NULL REFERENCES transmissions(id) ON DELETE CASCADE, transmission_contact_id UUID NOT NULL REFERENCES transmission_contacts(id), key_category TEXT NOT NULL CHECK (key_category IN ('k1','k2','k3')), -- Part Si re-chiffrée avec clé Redis éphémère share_tmp_enc BYTEA NOT NULL, -- Référence clé éphémère Redis (v1.1 : Redis, pas HCV) -- Clé Redis : 'escrow_key:{escrow_id}' avec TTL = escrow_expires_at -- XChaCha20(redis_ephemeral_key, Si) → share_tmp_enc redis_key_id TEXT NOT NULL, -- ex: 'escrow_key:uuid' — référence la clé dans Redis expires_at TIMESTAMPTZ NOT NULL, -- NOW() + escrow_ttl_hours created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_es_transmission ON escrow_shares(transmission_id);CREATE INDEX idx_es_expires ON escrow_shares(expires_at);CREATE INDEX idx_es_category ON escrow_shares(transmission_id, key_category);CREATE UNIQUE INDEX idx_es_contact_category ON escrow_shares(transmission_contact_id, key_category);-- Nettoyage horaire (job BullMQ) :-- DELETE FROM escrow_shares WHERE expires_at < NOW();-- Redis expire automatiquement les clés éphémères au même TTL |

# 19. audit_logs
| audit_logsJournal immuable de toutes les actions admin. Append-only.v1.1 : v1.1 : audit_writer role formalisé en DDL. |

| Aucune ligne n'est jamais modifiée ou supprimée. Le rôle audit_writer n'a que le droit INSERT. L'application utilise ce rôle dédié pour toutes les insertions dans cette table. |

| CREATE TABLE audit_logs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id UUID REFERENCES admin_users(id), user_id UUID, -- user concerné (NULL si action système) action TEXT NOT NULL CHECK (action IN ( 'ACCOUNT_UNBLOCK','ACCOUNT_SUSPEND','ACCOUNT_DELETE', 'OTP_REGEN','EMAIL_CHANGE','PHONE_CHANGE', 'CONTACT_UNBLOCK','ESCROW_EXTEND', 'TRANSMISSION_CANCEL','TRANSMISSION_NOTIFY', 'CONFIG_UPDATE','QUESTION_ADD', 'QUESTION_ARCHIVE','QUESTION_UPDATE', 'SUBSCRIPTION_EXTEND','PLAN_CHANGE', 'ADMIN_LOGIN','ADMIN_CREATED' )), target_type TEXT CHECK (target_type IN ( 'user','transmission','config','question', 'subscription','admin' )), target_id TEXT, value_before JSONB, value_after JSONB, reason TEXT, ip_hash TEXT NOT NULL, user_agent_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX idx_al_admin_id ON audit_logs(admin_id);CREATE INDEX idx_al_user_id ON audit_logs(user_id);CREATE INDEX idx_al_action ON audit_logs(action);CREATE INDEX idx_al_created ON audit_logs(created_at);-- Sécurité : rôle dédié INSERT-onlyCREATE ROLE audit_writer;GRANT INSERT ON audit_logs TO audit_writer;-- L'app utilise audit_writer uniquement pour les insertions dans cette table-- Le rôle principal de l'app n'a pas de droit UPDATE/DELETE sur audit_logsREVOKE UPDATE, DELETE ON audit_logs FROM app_user; |

# 20. support_tickets
| support_ticketsTickets de support entrants. |

| CREATE TABLE support_tickets ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), user_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ( 'account_locked','otp_issue','transmission', 'subscription','rgpd','other' )), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')), priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')), assigned_to UUID REFERENCES admin_users(id), resolution_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ);CREATE INDEX idx_st_status ON support_tickets(status);CREATE INDEX idx_st_priority ON support_tickets(priority, status);CREATE INDEX idx_st_user ON support_tickets(user_id); |

# 21. Diagramme des relations
| -- Tables sans dépendances entrantesadmin_userscheckin_questions-- Dépendent uniquement de admin_users ou checkin_questionsapp_config → admin_users-- Dépendent de usersusers ├── sessions (1-N) ├── email_otp (1-N, user_id nullable pour registration) ├── restore_challenges (1-N) ├── push_tokens (1-N) ├── subscriptions (1-1) ├── transmission_configs (1-1) │ └── trusted_contacts (1-N) │ ├── storj_k1/k2/k3_path → Storj (externe) │ └── has_k1/k2/k3_role (guide distribution Si_enc) ├── checkin_log (1-N) → checkin_questions ├── checkin_relances (1-N) → transmission_configs ├── journal_entries (1-N) → checkin_questions ├── annual_wrappeds (1-N) └── support_tickets (1-N)-- Déclenchement du DMStransmissions ├── transmission_configs (N-1) ├── transmission_contacts (1-N) → trusted_contacts └── escrow_shares (1-N) → Redis clé éphémère (externe)-- Auditaudit_logs → admin_users, users (nullable)-- Stockage externe (hors PostgreSQL)Storj : P2 vault + Si_enc (parts Shamir par Ki et par contact)Arbitrum : ed25519_pk, Hash(Si_enc), Hash(notification_enc+sig), config DMS, last_checkin timestamp, storj_vault_pathHCV : relais_private_key uniquementRedis : sessions step-up tokens, clés éphémères escrow, rate limitingEnv vars : DATABASE_URL, JWT secrets, STORJ keys, RESEND key, ARBITRUM RPC |

# 22. Politique de rétention et sécurité
## Données jamais stockées en PostgreSQL
- Seed ou 12 mots BIP39 — jamais côté serveur
- K1, K2, K3 — jamais côté serveur
- Réponses aux questions secrètes des contacts
- PIN — jamais côté serveur
- Si_enc (parts Shamir chiffrées) — sur Storj uniquement
- Contenu P1 ou P2 en clair
## Nettoyages automatiques (jobs BullMQ)
| Table | Fréquence | Condition |
| sessions | Quotidien | WHERE expires_at < NOW() |
| email_otp | Horaire | WHERE expires_at < NOW() |
| restore_challenges | Horaire | WHERE expires_at < NOW() OR used = true |
| escrow_shares | Horaire | WHERE expires_at < NOW() |
| Redis step-up tokens | — | TTL automatique Redis (5 min) |
| Redis escrow keys | — | TTL automatique Redis (aligné escrow_expires_at) |

## Politique de rétention des données
| Donnée | Rétention | Trigger |
| Données utilisateur | Jusqu'à suppression compte | Demande RGPD ou admin |
| Sessions expirées | Supprimées automatiquement | Job quotidien |
| OTP expirés | Supprimés automatiquement | Job horaire |
| Escrow (TTL 72h) | Supprimé après reconstitution ou expiration | Job horaire + completion |
| Transmission complétée | Log conservé — vault et Si_enc supprimés Storj | Post-mortem complet |
| Audit logs | Permanent — jamais supprimés | — |
| Compte supprimé RGPD | Log anonymisé dans audit_logs — PII supprimées sous 30j | Demande validée admin |

— Fin du Schéma PostgreSQL v1.1 —
20 tables — 19 corrections audit intégrées
