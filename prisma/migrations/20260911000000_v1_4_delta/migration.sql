\set ON_ERROR_STOP on
-- =============================================================================
-- RELAIS — Schéma v1.4 (delta) + Proposals v1.5 adoptées (septembre 2026)
--
--   Point-1     email_log.email_type : 'contact_designated' (désignation à
--               l'activation, Backend v1.1 §4.3 étape 6). Les cinq types de
--               sécurité compte étaient déjà là (migration 20260425000000).
--   Proposal-9  'contact_progress' : prévenir les autres contacts quand l'un
--               d'eux est bloqué (E5-US02) ou a confirmé (E5-US03).
--   Point-2     two_factor_recovery_codes : 8 codes de secours hachés,
--               usage unique (E6-US02).
--   Proposal-8  trusted_contacts.share_kN_plain_hash : SHA256(Si) signé
--               Ed25519 à l'activation ; POST /relay/:token/verify compare
--               avant l'escrow. 32 bytes par part, aucune information sur Si.
-- =============================================================================

BEGIN;

-- ---- Point-1 + Proposal-9 : types d'email ----------------------------------

ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_email_type_check;

ALTER TABLE email_log ADD CONSTRAINT email_log_email_type_check CHECK (email_type IN (
    -- OTP
    'otp_registration', 'otp_email_change', 'otp_password_reset',
    -- Sécurité compte
    'account_locked', 'account_unblocked', 'account_suspended',
    'password_changed', 'restore_succeeded',
    'two_factor_enabled', 'two_factor_disabled',
    -- Transmission
    'contact_designated',
    'checkin_relance_1', 'checkin_relance_2', 'checkin_relance_3',
    'transmission_contact',
    'contact_progress',
    -- Abonnements
    'subscription_expiring', 'subscription_expired'
));

-- ---- Point-2 : codes de récupération 2FA -----------------------------------

CREATE TABLE two_factor_recovery_codes (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  CHAR(64)    NOT NULL,  -- SHA256(code) — jamais le code en clair
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_code UNIQUE (user_id, code_hash)
);

CREATE INDEX idx_2fa_user ON two_factor_recovery_codes(user_id) WHERE used_at IS NULL;

-- ---- Proposal-8 : hash de la part en clair ---------------------------------

ALTER TABLE trusted_contacts
    ADD COLUMN share_k1_plain_hash TEXT,
    ADD COLUMN share_k2_plain_hash TEXT,
    ADD COLUMN share_k3_plain_hash TEXT,
    ADD CONSTRAINT chk_share_k1_plain_hash CHECK (share_k1_plain_hash IS NULL OR length(share_k1_plain_hash) = 64),
    ADD CONSTRAINT chk_share_k2_plain_hash CHECK (share_k2_plain_hash IS NULL OR length(share_k2_plain_hash) = 64),
    ADD CONSTRAINT chk_share_k3_plain_hash CHECK (share_k3_plain_hash IS NULL OR length(share_k3_plain_hash) = 64);

COMMIT;
