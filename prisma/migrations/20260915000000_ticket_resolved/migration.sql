-- =============================================================================
-- Points ouverts (12/09/2026) — le demandeur d'un ticket est prévenu de sa
-- résolution, avec la note. Nouveau type email_log 'ticket_resolved' ;
-- user_id NULL pour un ticket ouvert sans compte (hash du destinataire
-- seulement, comme les autres).
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
    'transmission_triggered', 'contact_answered', 'contact_blocked', 'contact_unblocked',
    -- Support (12/09/2026)
    'ticket_resolved',
    -- Abonnements
    'subscription_expiring', 'subscription_expired'
));
