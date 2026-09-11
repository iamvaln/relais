\set ON_ERROR_STOP on
-- =============================================================================
-- Audit des tickets support (BO-02, BO-06)
--
-- La liste v1.3 des actions auditées ne prévoyait rien pour les tickets ;
-- BO-06 exige que toute action du back office soit journalisée.
-- TICKET_UPDATE couvre prise en charge, priorité, assignation, résolution.
-- =============================================================================

BEGIN;

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (action IN (
    'ACCOUNT_UNBLOCK', 'ACCOUNT_SUSPEND', 'ACCOUNT_DELETE',
    'OTP_REGEN', 'EMAIL_CHANGE', 'PHONE_CHANGE',
    'CONTACT_UNBLOCK', 'ESCROW_EXTEND',
    'TRANSMISSION_CANCEL', 'TRANSMISSION_NOTIFY',
    'CONFIG_UPDATE', 'QUESTION_ADD',
    'QUESTION_ARCHIVE', 'QUESTION_UPDATE',
    'SUBSCRIPTION_EXTEND', 'PLAN_CHANGE',
    'ADMIN_LOGIN', 'ADMIN_CREATED',
    'TICKET_UPDATE'
));

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_target_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_target_type_check CHECK (target_type IN (
    'user', 'transmission', 'config', 'question', 'subscription', 'admin', 'ticket'
));

COMMIT;
