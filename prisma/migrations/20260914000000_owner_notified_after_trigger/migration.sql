-- =============================================================================
-- Points ouverts (12/09/2026) — l'owner est prévenu après le déclenchement.
-- Un déclenchement n'est pas une preuve de décès : un owner vivant qui a
-- manqué ses relances doit savoir que son coffre s'ouvre, qu'un contact a
-- réussi ses questions, qu'un contact est bloqué ou qu'un admin l'a
-- débloqué — et pouvoir annuler lui-même (POST /transmission/cancel).
-- Quatre types email_log ; jamais d'identité de contact dans ces emails.
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
    -- Owner prévenu après le déclenchement (12/09/2026)
    'transmission_triggered', 'contact_answered', 'contact_blocked', 'contact_unblocked',
    -- Abonnements
    'subscription_expiring', 'subscription_expired'
));
