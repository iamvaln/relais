\set ON_ERROR_STOP on
-- =============================================================================
-- RELAIS — Schéma PostgreSQL v1.1
-- Transcription fidèle de specs/Relais_Schema_PostgreSQL_v1.docx
--
-- 20 tables, dans l'ordre de création imposé par les dépendances de clés
-- étrangères. Ce fichier est la SOURCE DE VÉRITÉ du schéma : les CHECK
-- constraints, index partiels et rôles ci-dessous ne sont pas exprimables
-- dans schema.prisma, qui n'en est qu'un miroir pour le client typé.
--
-- Zero-knowledge : PostgreSQL ne contient jamais de données déchiffrées.
-- Les Si_enc (parts Shamir) sont sur Storj. Seuls les hashes sont on-chain
-- Arbitrum. relais_private_key est dans HCV Secrets Engine.
-- =============================================================================

-- Atomique : tout ou rien. Un échec en cours de route ne laisse pas la base
-- à moitié migrée et le fichier reste rejouable.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. admin_users — comptes back office
-- Premier : référencé par app_config, transmissions, subscriptions, audit_logs.
-- =============================================================================

CREATE TABLE admin_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
    full_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL, -- Argon2id
    role          TEXT NOT NULL DEFAULT 'support'
                  CHECK (role IN ('super_admin', 'admin', 'support', 'finance')),

    -- Secret TOTP en clair (standard TOTP). NULL jusqu'à l'activation.
    totp_secret  TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT false,

    status TEXT NOT NULL DEFAULT 'active'
           CHECK (status IN ('active', 'suspended')),

    login_fail_count   INT NOT NULL DEFAULT 0,
    login_locked_until TIMESTAMPTZ,
    last_login_at      TIMESTAMPTZ,

    created_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. app_config — paramètres système modifiables depuis le back office
-- Toute modification est loggée dans audit_logs.
-- =============================================================================

CREATE TABLE app_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    config_type TEXT NOT NULL DEFAULT 'string'
                CHECK (config_type IN ('string', 'int', 'bool', 'json', 'array_int')),
    category    TEXT NOT NULL
                CHECK (category IN ('dms', 'security', 'vault', 'notifications', 'billing')),
    description TEXT NOT NULL,
    updated_by  UUID REFERENCES admin_users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (key, value, config_type, category, description) VALUES
    ('dms.durations_available',    '[1,3,6]',  'array_int', 'dms',      'Durées DMS disponibles en mois'),
    ('dms.relance_count',          '3',        'int',       'dms',      'Nb relances avant déclenchement'),
    ('dms.relance_intervals_days', '[7,14,21]','array_int', 'dms',      'Intervalles relances en jours'),
    ('dms.escrow_ttl_hours',       '72',       'int',       'dms',      'TTL escrow en heures'),
    ('dms.escrow_max_extensions',  '2',        'int',       'dms',      'Max extensions escrow par transmission'),
    ('dms.pause_max_months',       '3',        'int',       'dms',      'Durée max mode pause'),
    ('security.pin_max_attempts',  '5',        'int',       'security', 'Tentatives PIN avant blocage'),
    ('security.pin_lockout_min',   '30',       'int',       'security', 'Durée blocage PIN en minutes'),
    ('security.pwd_max_attempts',  '5',        'int',       'security', 'Tentatives mot de passe avant blocage'),
    ('security.session_months',    '3',        'int',       'security', 'Durée de vie session en mois'),
    ('security.otp_validity_min',  '10',       'int',       'security', 'Validité OTP email en minutes'),
    ('security.otp_max_regen_hr',  '5',        'int',       'security', 'Max regénérations OTP par heure'),
    ('security.contact_max_fail',  '5',        'int',       'security', 'Tentatives questions contact avant blocage'),
    ('security.contact_lock_hrs',  '24',       'int',       'security', 'Durée blocage contact en heures'),
    ('vault.free_max_accounts',    '5',        'int',       'vault',    'Comptes max plan gratuit'),
    ('vault.free_max_contacts',    '2',        'int',       'vault',    'Contacts max plan gratuit (incompressible)'),
    ('vault.premium_max_contacts', '5',        'int',       'vault',    'Contacts max plan premium'),
    ('vault.max_size_mb',          '50',       'int',       'vault',    'Taille max vault en Mo'),
    ('vault.question_min_score',   '6',        'int',       'vault',    'Score min questions proposées aux users'),
    ('vault.questions_per_contact','3',        'int',       'vault',    'Nb questions requises par contact'),
    ('billing.premium_price_fcfa', '10000',    'int',       'billing',  'Prix abonnement premium annuel en FCFA'),
    ('billing.grace_period_days',  '7',        'int',       'billing',  'Jours de grâce après expiration'),
    ('billing.trial_days',         '0',        'int',       'billing',  'Jours essai gratuit (0 = désactivé)');

-- =============================================================================
-- 3. checkin_questions — bibliothèque admin
-- Deux usages : questions secrètes des contacts ET questions du carnet de vie.
-- =============================================================================

CREATE TABLE checkin_questions (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text_fr  TEXT NOT NULL,
    text_en  TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'childhood', 'places', 'events', 'people', 'habits',
        'month_memory', 'relations', 'work', 'gratitude',
        'introspection', 'legacy', 'lightness'
    )),
    usage_type TEXT NOT NULL DEFAULT 'both'
               CHECK (usage_type IN ('secret_question', 'journal', 'both')),

    -- Scoring (questions secrètes uniquement)
    reliability_score INT NOT NULL DEFAULT 7 CHECK (reliability_score BETWEEN 1 AND 10),
    failure_rate      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (failure_rate BETWEEN 0 AND 100),
    block_rate        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (block_rate BETWEEN 0 AND 100),
    avg_attempts      NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (avg_attempts >= 1),

    -- Cycle annuel (carnet de vie uniquement)
    cycle_month INT CHECK (cycle_month BETWEEN 1 AND 12),
    mode_target TEXT DEFAULT 'all' CHECK (mode_target IN ('essential', 'reflective', 'all')),

    status TEXT NOT NULL DEFAULT 'active'
           CHECK (status IN ('active', 'archived', 'review')),
    usage_count INT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cq_category   ON checkin_questions(category);
CREATE INDEX idx_cq_usage_type ON checkin_questions(usage_type);
CREATE INDEX idx_cq_status     ON checkin_questions(status);
CREATE INDEX idx_cq_score      ON checkin_questions(reliability_score)
    WHERE status = 'active' AND usage_type IN ('secret_question', 'both');
CREATE INDEX idx_cq_cycle      ON checkin_questions(cycle_month)
    WHERE usage_type IN ('journal', 'both') AND status = 'active';

-- =============================================================================
-- 4. users — comptes utilisateurs, source d'identité principale
-- =============================================================================

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
    phone         TEXT,
    full_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL, -- Argon2id(password)
    language      TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en')),

    -- Identité blockchain (DEC-05).
    -- Clé publique dérivée du seed. NULL jusqu'à la complétion de l'onboarding.
    ed25519_pk BYTEA UNIQUE,

    -- Statut
    email_verified BOOLEAN NOT NULL DEFAULT false,
    account_status TEXT NOT NULL DEFAULT 'pending_verification'
                   CHECK (account_status IN (
                       'pending_verification', 'active', 'suspended', 'deleted'
                   )),
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),

    -- 2FA — secret TOTP standard, stocké en clair côté serveur
    totp_secret  TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT false,

    -- Sécurité — compteurs d'échecs
    login_fail_count   INT NOT NULL DEFAULT 0,
    login_locked_until TIMESTAMPTZ,
    otp_fail_count     INT NOT NULL DEFAULT 0,
    otp_locked_until   TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Suppression RGPD
    deleted_at      TIMESTAMPTZ,
    deleted_by      TEXT CHECK (deleted_by IN ('user', 'admin')),
    deleted_by_admin UUID REFERENCES admin_users(id),
    deletion_reason TEXT -- motif admin, ou 'user_request' si self-delete
);

CREATE INDEX idx_users_email   ON users(email);
CREATE INDEX idx_users_ed25519 ON users(ed25519_pk) WHERE ed25519_pk IS NOT NULL;
CREATE INDEX idx_users_status  ON users(account_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_active  ON users(created_at) WHERE deleted_at IS NULL;

-- =============================================================================
-- 5. sessions — refresh tokens actifs, un par device
-- =============================================================================

CREATE TABLE sessions (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- HMAC-SHA256(token, server_secret) — longueur fixe 64 hex
    refresh_token_hash TEXT NOT NULL UNIQUE CHECK (length(refresh_token_hash) = 64),

    device_info TEXT, -- user-agent tronqué (< 200 chars)
    ip_hash     TEXT, -- SHA256(IP) pour audit — jamais l'IP en clair

    expires_at   TIMESTAMPTZ NOT NULL, -- NOW() + 90 jours
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
-- Job BullMQ quotidien : DELETE FROM sessions WHERE expires_at < NOW();

-- =============================================================================
-- 6. email_otp — OTP email temporaires
-- Couvre registration, email_change, password_reset.
-- =============================================================================

CREATE TABLE email_otp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL si l'utilisateur n'est pas encore créé (registration)
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email   TEXT NOT NULL,

    -- SHA256(otp_code) — jamais le code en clair
    otp_hash TEXT NOT NULL CHECK (length(otp_hash) = 64),

    purpose TEXT NOT NULL CHECK (purpose IN (
        'registration', 'email_change', 'password_reset'
    )),

    expires_at TIMESTAMPTZ NOT NULL, -- NOW() + 10 minutes
    used_at    TIMESTAMPTZ,          -- NULL si pas encore utilisé
    attempts   INT NOT NULL DEFAULT 0 CHECK (attempts <= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_email   ON email_otp(email, purpose) WHERE used_at IS NULL;
CREATE INDEX idx_otp_expires ON email_otp(expires_at);
-- Job BullMQ horaire : DELETE FROM email_otp WHERE expires_at < NOW();
-- Max 5 OTP actifs par heure par email, contrôlé en application
-- (app_config: security.otp_max_regen_hr = 5)

-- =============================================================================
-- 7. restore_challenges — challenge-response Ed25519 (DEC-06)
-- =============================================================================

CREATE TABLE restore_challenges (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    challenge  BYTEA NOT NULL,       -- 32 bytes aléatoires
    expires_at TIMESTAMPTZ NOT NULL, -- NOW() + 5 minutes
    used       BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rc_user_id ON restore_challenges(user_id);
CREATE INDEX idx_rc_expires ON restore_challenges(expires_at);
-- Job BullMQ : DELETE FROM restore_challenges WHERE expires_at < NOW() OR used = true;
--
-- Flow :
--   GET  /auth/restore/challenge → INSERT challenge, retourne les bytes
--   POST /auth/restore/verify    → Ed25519.verify(signature, challenge, ed25519_pk)
--                                → UPDATE used = true si valide

-- =============================================================================
-- 8. push_tokens — tokens push Expo pour les notifications de check-in
-- =============================================================================

CREATE TABLE push_tokens (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    token    TEXT NOT NULL, -- ex: ExponentPushToken[xxxxxx]
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    active   BOOLEAN NOT NULL DEFAULT true,

    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pt_token ON push_tokens(token);
CREATE INDEX idx_pt_user ON push_tokens(user_id) WHERE active = true;

-- =============================================================================
-- 9. subscriptions — abonnements premium, un par utilisateur
-- =============================================================================

CREATE TABLE subscriptions (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    plan   TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
    status TEXT NOT NULL DEFAULT 'active'
           CHECK (status IN ('active', 'grace', 'expired', 'cancelled')),

    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ, -- NULL si plan free
    grace_until  TIMESTAMPTZ, -- expires_at + billing.grace_period_days
    cancelled_at TIMESTAMPTZ,

    price_fcfa INT CHECK (price_fcfa > 0),
    currency   TEXT NOT NULL DEFAULT 'XAF',
    auto_renew BOOLEAN NOT NULL DEFAULT true,

    -- Historique des extensions admin
    extended_count   INT NOT NULL DEFAULT 0,
    last_extended_by UUID REFERENCES admin_users(id),
    last_extended_at TIMESTAMPTZ,
    extension_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sub_expires ON subscriptions(expires_at)
    WHERE status IN ('active', 'grace');

-- =============================================================================
-- 10. transmission_configs — configuration du dead man's switch
-- =============================================================================

CREATE TABLE transmission_configs (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN (
        'inactive', 'active', 'paused', 'triggered', 'completed'
    )),

    silence_duration_months INT NOT NULL DEFAULT 1 CHECK (silence_duration_months IN (1, 3, 6)),
    checkin_frequency_weeks INT NOT NULL DEFAULT 4 CHECK (checkin_frequency_weeks IN (1, 2, 4)),

    schema_n INT NOT NULL DEFAULT 2 CHECK (schema_n >= 2),
    schema_m INT NOT NULL DEFAULT 2 CHECK (schema_m >= schema_n),

    -- Pointeur vault Storj
    storj_vault_path TEXT, -- ex: 'payloads/{user_id}/'

    -- Blockchain
    arbitrum_address    TEXT,
    contract_registered BOOLEAN NOT NULL DEFAULT false,

    -- Check-in
    last_checkin_at  TIMESTAMPTZ,
    next_checkin_due TIMESTAMPTZ,
    relance_count    INT NOT NULL DEFAULT 0 CHECK (relance_count BETWEEN 0 AND 3),
    last_relance_at  TIMESTAMPTZ,

    -- Mode pause
    paused_at   TIMESTAMPTZ,
    pause_until TIMESTAMPTZ,

    activated_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tc_status  ON transmission_configs(status);
-- Index partiel : seulement les transmissions actives
CREATE INDEX idx_tc_checkin ON transmission_configs(next_checkin_due) WHERE status = 'active';

-- =============================================================================
-- 11. trusted_contacts — deux niveaux de données (DEC-12)
--
--   notification_enc : chiffré avec relais_public_key — Relais peut lire
--                      pour notifier.
--   notification_sig : signature Ed25519 owner — protège contre toute
--                      modification.
--   secret_enc       : chiffré K2 — Relais ne peut pas lire.
--
-- Les Si_enc sont sur Storj, jamais en PostgreSQL.
-- =============================================================================

CREATE TABLE trusted_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_order   INT NOT NULL CHECK (contact_order >= 1),

    -- NIVEAU 1 — données de notification (Relais peut lire pour notifier)
    notification_enc  BYTEA NOT NULL,
    notification_sig  BYTEA NOT NULL, -- Ed25519.sign(notification_enc, owner_sk)
    notification_hash TEXT NOT NULL   -- SHA256(notification_enc || notification_sig) hex
                      CHECK (length(notification_hash) = 64),

    -- NIVEAU 2 — données secrètes (Relais ne peut PAS lire)
    secret_enc BYTEA NOT NULL, -- {nom, rôle, questions, message} chiffré K2

    -- Rôles lisibles par le serveur — le nom du rôle reste dans secret_enc.
    -- Nécessaire pour savoir quels Si_enc distribuer lors du déclenchement.
    has_k1_role BOOLEAN NOT NULL DEFAULT false, -- Gestionnaire pratique
    has_k2_role BOOLEAN NOT NULL DEFAULT false, -- Gardien du souvenir
    has_k3_role BOOLEAN NOT NULL DEFAULT false, -- Exécuteur financier

    -- Parts Shamir sur Storj — un chemin par catégorie de clé.
    -- NULL si le contact n'a pas ce rôle.
    storj_k1_path TEXT,
    storj_k2_path TEXT,
    storj_k3_path TEXT,

    -- Hashes on-chain (copie locale du hash Arbitrum)
    share_k1_hash TEXT,
    share_k2_hash TEXT,
    share_k3_hash TEXT,

    -- Vérification annuelle des réponses
    verify_token           BYTEA, -- XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1') ~40 bytes
    verify_last_checked_at TIMESTAMPTZ,

    contact_status TEXT NOT NULL DEFAULT 'active'
                   CHECK (contact_status IN ('active', 'blocked', 'removed')),
    fail_count     INT NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
    blocked_until  TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_contact_order UNIQUE (transmission_id, contact_order),
    CONSTRAINT chk_roles CHECK (has_k1_role OR has_k2_role OR has_k3_role),
    CONSTRAINT chk_share_k1_hash CHECK (share_k1_hash IS NULL OR length(share_k1_hash) = 64),
    CONSTRAINT chk_share_k2_hash CHECK (share_k2_hash IS NULL OR length(share_k2_hash) = 64),
    CONSTRAINT chk_share_k3_hash CHECK (share_k3_hash IS NULL OR length(share_k3_hash) = 64)
);

CREATE INDEX idx_tcon_transmission ON trusted_contacts(transmission_id);
CREATE INDEX idx_tcon_user         ON trusted_contacts(user_id);
CREATE INDEX idx_tcon_status       ON trusted_contacts(contact_status) WHERE contact_status = 'active';

-- =============================================================================
-- 12. checkin_log — historique des check-ins validés
-- =============================================================================

CREATE TABLE checkin_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE,

    checkin_month DATE NOT NULL,
    question_id   UUID REFERENCES checkin_questions(id),

    game_type TEXT NOT NULL DEFAULT 'riddle' CHECK (game_type IN (
        'riddle', 'sequence', 'sort', 'word_search', 'puzzle'
    )),
    game_completed_at TIMESTAMPTZ NOT NULL,
    attempts          INT NOT NULL DEFAULT 1 CHECK (attempts >= 1),

    -- Lié à journal_entries si une réponse a été donnée.
    -- Pas de FK : journal_entries est créée après cette table.
    journal_entry_id UUID,

    streak_at_checkin INT NOT NULL DEFAULT 1 CHECK (streak_at_checkin >= 1),
    badge_earned      TEXT,
    arbitrum_tx_hash  TEXT, -- hash de la tx checkin() on-chain Arbitrum

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cl_user_id ON checkin_log(user_id);
CREATE INDEX idx_cl_month   ON checkin_log(checkin_month);
CREATE UNIQUE INDEX idx_cl_user_month ON checkin_log(user_id, checkin_month);

-- =============================================================================
-- 13. checkin_relances — traçabilité des 3 relances par check-in manqué
-- =============================================================================

CREATE TABLE checkin_relances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE,

    relance_number INT NOT NULL CHECK (relance_number BETWEEN 1 AND 3),
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    email_provider_id TEXT, -- ID Resend pour le tracking de délivrance
    delivery_status   TEXT NOT NULL DEFAULT 'sent'
                      CHECK (delivery_status IN ('sent', 'delivered', 'bounced', 'failed'))
);

CREATE INDEX idx_cr_user         ON checkin_relances(user_id);
CREATE INDEX idx_cr_transmission ON checkin_relances(transmission_id);

-- =============================================================================
-- 14. journal_entries — carnet de vie, contenu chiffré avec K2
--
-- Pas de sync_status : la sync du journal fait partie du vault P2 global,
-- et la source de vérité de synchronisation est le SQLite local.
-- =============================================================================

CREATE TABLE journal_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id UUID REFERENCES checkin_questions(id),

    entry_month DATE NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'essential'
                CHECK (mode IN ('essential', 'reflective', 'free')),

    content_enc BYTEA NOT NULL, -- chiffré K2 — Relais ne peut pas lire

    -- Calculé localement avant chiffrement, pour les stats Wrapped
    -- sans avoir à déchiffrer.
    word_count_approx INT CHECK (word_count_approx >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_je_user  ON journal_entries(user_id);
CREATE INDEX idx_je_month ON journal_entries(entry_month);
CREATE UNIQUE INDEX idx_je_user_month ON journal_entries(user_id, entry_month);

-- =============================================================================
-- 15. annual_wrappeds — Wrapped annuels
-- =============================================================================

CREATE TABLE annual_wrappeds (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year    INT NOT NULL CHECK (year >= 2026),

    -- { entries_count, max_streak, dominant_themes, most_used_word,
    --   richest_month, total_words, badges_earned[] } chiffré K2
    stats_enc BYTEA NOT NULL,

    entry_count INT NOT NULL DEFAULT 0, -- en clair, pour le back office
    exported    BOOLEAN NOT NULL DEFAULT false,
    exported_at TIMESTAMPTZ,

    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_aw_user_year ON annual_wrappeds(user_id, year);

-- =============================================================================
-- 16. transmissions — dead man's switch déclenchés
-- =============================================================================

CREATE TABLE transmissions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transmission_config_id UUID NOT NULL REFERENCES transmission_configs(id),
    user_id                UUID NOT NULL REFERENCES users(id),

    status TEXT NOT NULL DEFAULT 'triggered' CHECK (status IN (
        'triggered', 'in_progress', 'completed', 'cancelled', 'expired'
    )),

    triggered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- triggered_at + dms.escrow_ttl_hours (depuis app_config)
    escrow_expires_at     TIMESTAMPTZ NOT NULL,
    escrow_extended_count INT NOT NULL DEFAULT 0 CHECK (escrow_extended_count <= 2),
    completed_at          TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,

    arbitrum_trigger_block TEXT,

    -- Snapshot N-of-M au moment du déclenchement
    schema_n_snapshot INT NOT NULL,
    schema_m_snapshot INT NOT NULL,

    -- Progression par catégorie
    k1_completed BOOLEAN NOT NULL DEFAULT false,
    k2_completed BOOLEAN NOT NULL DEFAULT false,
    k3_completed BOOLEAN NOT NULL DEFAULT false,

    cancelled_by_admin  UUID REFERENCES admin_users(id),
    cancellation_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tr_config ON transmissions(transmission_config_id);
CREATE INDEX idx_tr_status ON transmissions(status);
CREATE INDEX idx_tr_escrow ON transmissions(escrow_expires_at) WHERE status = 'in_progress';

-- =============================================================================
-- 17. transmission_contacts — statut de chaque contact pour une transmission
-- =============================================================================

CREATE TABLE transmission_contacts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transmission_id   UUID NOT NULL REFERENCES transmissions(id) ON DELETE CASCADE,
    trusted_contact_id UUID NOT NULL REFERENCES trusted_contacts(id),

    -- HMAC-SHA256(token, server_secret)
    relay_token_hash       TEXT NOT NULL UNIQUE CHECK (length(relay_token_hash) = 64),
    relay_token_expires_at TIMESTAMPTZ NOT NULL,
    relay_token_used       BOOLEAN NOT NULL DEFAULT false,

    status TEXT NOT NULL DEFAULT 'notified'
           CHECK (status IN ('notified', 'answered', 'failed', 'confirmed')),
    fail_count INT NOT NULL DEFAULT 0 CHECK (fail_count <= 5),
    blocked    BOOLEAN NOT NULL DEFAULT false,

    notified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at  TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX idx_trc_transmission ON transmission_contacts(transmission_id);
CREATE INDEX idx_trc_status       ON transmission_contacts(status);

-- =============================================================================
-- 18. escrow_shares — parts Si_tmp pendant la reconstitution, TTL 72h
--
-- Les Si_enc permanents sont sur Storj. L'escrow ne contient que les parts
-- déchiffrées puis re-chiffrées avec une clé Redis éphémère, le temps que N
-- contacts aient répondu. La clé Redis expire en même temps que
-- escrow_expires_at.
-- =============================================================================

CREATE TABLE escrow_shares (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transmission_id        UUID NOT NULL REFERENCES transmissions(id) ON DELETE CASCADE,
    transmission_contact_id UUID NOT NULL REFERENCES transmission_contacts(id),

    key_category TEXT NOT NULL CHECK (key_category IN ('k1', 'k2', 'k3')),

    -- XChaCha20(redis_ephemeral_key, Si) → share_tmp_enc
    share_tmp_enc BYTEA NOT NULL,

    -- Référence de la clé éphémère dans Redis : 'escrow_key:{escrow_id}',
    -- avec TTL aligné sur escrow_expires_at.
    redis_key_id TEXT NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL, -- NOW() + dms.escrow_ttl_hours
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_es_transmission ON escrow_shares(transmission_id);
CREATE INDEX idx_es_expires      ON escrow_shares(expires_at);
CREATE INDEX idx_es_category     ON escrow_shares(transmission_id, key_category);
CREATE UNIQUE INDEX idx_es_contact_category
    ON escrow_shares(transmission_contact_id, key_category);
-- Nettoyage horaire (job BullMQ) :
--   DELETE FROM escrow_shares WHERE expires_at < NOW();
-- Redis expire automatiquement les clés éphémères au même TTL.

-- =============================================================================
-- 19. audit_logs — journal immuable des actions admin, append-only
--
-- Aucune ligne n'est jamais modifiée ni supprimée. Le rôle audit_writer n'a
-- que le droit INSERT ; l'application l'utilise pour toutes les insertions
-- dans cette table.
-- =============================================================================

CREATE TABLE audit_logs (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admin_users(id),
    user_id  UUID, -- user concerné (NULL si action système)

    action TEXT NOT NULL CHECK (action IN (
        'ACCOUNT_UNBLOCK', 'ACCOUNT_SUSPEND', 'ACCOUNT_DELETE',
        'OTP_REGEN', 'EMAIL_CHANGE', 'PHONE_CHANGE',
        'CONTACT_UNBLOCK', 'ESCROW_EXTEND',
        'TRANSMISSION_CANCEL', 'TRANSMISSION_NOTIFY',
        'CONFIG_UPDATE', 'QUESTION_ADD',
        'QUESTION_ARCHIVE', 'QUESTION_UPDATE',
        'SUBSCRIPTION_EXTEND', 'PLAN_CHANGE',
        'ADMIN_LOGIN', 'ADMIN_CREATED'
    )),

    target_type TEXT CHECK (target_type IN (
        'user', 'transmission', 'config', 'question', 'subscription', 'admin'
    )),
    target_id TEXT,

    value_before JSONB,
    value_after  JSONB,
    reason       TEXT,

    ip_hash         TEXT NOT NULL,
    user_agent_hash TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_al_admin_id ON audit_logs(admin_id);
CREATE INDEX idx_al_user_id  ON audit_logs(user_id);
CREATE INDEX idx_al_action   ON audit_logs(action);
CREATE INDEX idx_al_created  ON audit_logs(created_at);

-- =============================================================================
-- 20. support_tickets
-- =============================================================================

CREATE TABLE support_tickets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id),
    user_email TEXT NOT NULL,

    subject TEXT NOT NULL,
    body    TEXT NOT NULL,

    category TEXT NOT NULL DEFAULT 'other' CHECK (category IN (
        'account_locked', 'otp_issue', 'transmission',
        'subscription', 'rgpd', 'other'
    )),
    status TEXT NOT NULL DEFAULT 'open'
           CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT NOT NULL DEFAULT 'normal'
             CHECK (priority IN ('urgent', 'high', 'normal', 'low')),

    assigned_to     UUID REFERENCES admin_users(id),
    resolution_note TEXT,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_st_status   ON support_tickets(status);
CREATE INDEX idx_st_priority ON support_tickets(priority, status);
CREATE INDEX idx_st_user     ON support_tickets(user_id);

COMMIT;
