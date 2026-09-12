-- =============================================================================
-- Lot 5 mobile (12/09/2026) — E4-US04 : rappel trois jours avant la fin
-- d'une pause. Nouveau type email_log 'pause_ending', tracé comme les autres
-- (hash du destinataire, jamais l'adresse). Les pushs OneSignal ne sont pas
-- tracés en base (décision du 12/09/2026, docs/mobile.md §3).
-- =============================================================================

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
    'pause_ending',
    'transmission_contact',
    'contact_progress',
    -- Abonnements
    'subscription_expiring', 'subscription_expired'
));

COMMENT ON COLUMN push_tokens.token IS 'Identifiant d''abonnement OneSignal du device (lot 5 mobile) ; l''utilisateur est ciblé par external_id = SHA256(user_id)';
