\set ON_ERROR_STOP on
-- =============================================================================
-- RELAIS — email_log.email_type : types de notification manquants
--
-- Le CHECK de la spec v1.3 ne prévoit aucun type pour des emails que les
-- user stories exigent pourtant :
--
--   account_locked       Backend Specs §2.5 — « 5 tentatives mot de passe
--                        échouées : compte bloqué 15 min. Email de notification. »
--   password_changed     E6-US03 — « Un email de notification est envoyé »
--   restore_succeeded    E6-US01 — « Un email de notification est envoyé sur
--                        l'adresse enregistrée après restauration réussie »
--   two_factor_enabled   E6-US02 — activation du TOTP
--   two_factor_disabled  E6-US02 — désactivation du TOTP
--
-- Sans ces valeurs, l'API devrait soit ne pas envoyer ces emails (et violer
-- les stories), soit les envoyer sans les tracer (et violer DEC-24). Ajout
-- proposé pour la spec v1.4 — voir docs/open-questions.md.
-- =============================================================================

BEGIN;

ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_email_type_check;

ALTER TABLE email_log ADD CONSTRAINT email_log_email_type_check CHECK (email_type IN (
    -- v1.3
    'otp_registration', 'otp_email_change', 'otp_password_reset',
    'checkin_relance_1', 'checkin_relance_2', 'checkin_relance_3',
    'transmission_contact',
    'account_suspended', 'account_unblocked',
    'subscription_expiring', 'subscription_expired',
    -- ajoutés
    'account_locked',
    'password_changed',
    'restore_succeeded',
    'two_factor_enabled',
    'two_factor_disabled'
));

COMMIT;
