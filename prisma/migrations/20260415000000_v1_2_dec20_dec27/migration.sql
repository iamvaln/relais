\set ON_ERROR_STOP on
-- =============================================================================
-- RELAIS — Schéma PostgreSQL v1.1 → v1.2
-- Transcription de specs/Relais_Schema_PostgreSQL_v1.docx (v1.2)
-- et de l'Addendum Journal des Décisions v1.1 (DEC-20 à DEC-27).
--
--   DEC-20   questions secrètes = 3 FK vers checkin_questions
--   DEC-22   silence_duration_months DEFAULT 3
--   DEC-24   nouvelles tables email_log et payment_events
--   DEC-26   app_config : security.pin_backoff_steps
--   Fix-09a  FK différée checkin_log → journal_entries
--
-- DEC-21, DEC-23, DEC-25 et DEC-27 ne touchent pas le schéma (vault local,
-- destinataire = trusted_contact, step-up en Redis, renommage d'endpoint).
-- Fix-06 (collision idx_tc_status) est déjà appliqué dans la migration 1.
-- =============================================================================

-- Atomique : tout ou rien. Un échec en cours de route ne laisse pas la base
-- à moitié migrée et le fichier reste rejouable.
BEGIN;

-- -----------------------------------------------------------------------------
-- DEC-22 — silence_duration_months : DEFAULT 1 → 3
--
-- Aligne le déclenchement des relances sur la déconnexion pour inactivité
-- (security.session_months = 3), comme l'exigent les Specs Techniques §7.3.
-- -----------------------------------------------------------------------------

ALTER TABLE transmission_configs
    ALTER COLUMN silence_duration_months SET DEFAULT 3;

-- -----------------------------------------------------------------------------
-- DEC-26 — backoff progressif du PIN
--
-- Remplace le blocage fixe. Appliqué 100 % côté client : le PIN ne transite
-- jamais sur le réseau, cette valeur n'est donc que la source de configuration
-- que l'app télécharge. security.pin_lockout_min reste en base pour
-- compatibilité mais n'est plus lu par le PIN Gate.
-- -----------------------------------------------------------------------------

INSERT INTO app_config (key, value, config_type, category, description) VALUES
    ('security.pin_backoff_steps', '[30,120,600,1800]', 'array_int', 'security',
     'Durées de blocage PIN progressives en secondes : 30s, 2min, 10min, 30min')
ON CONFLICT (key) DO NOTHING;

-- Note : la spec v1.2 §2 contient
--     UPDATE app_config SET value = '3' WHERE key = 'dms.durations_available';
-- qui contredit son propre commentaire (« reste [1,3,6] ») et écraserait un
-- array_int par un scalaire. Volontairement NON appliqué — voir
-- docs/open-questions.md §1.

-- -----------------------------------------------------------------------------
-- DEC-20 — Les questions secrètes deviennent des références
--
-- Avant : secret_enc = XChaCha20(K2, { nom, rôle, questions, message })
--         → le contact n'a pas K2, il ne pouvait donc jamais voir ses questions.
-- Après : secret_enc = XChaCha20(K2, { nom, rôle, message_personnel })
--         + 3 FK vers checkin_questions, dont le texte est public.
--
-- GET /relay/:token sert les libellés sans aucun déchiffrement.
--
-- Les colonnes sont NOT NULL : cette migration échoue volontairement si des
-- contacts existent déjà, plutôt que d'inventer des questions par défaut.
-- -----------------------------------------------------------------------------

ALTER TABLE trusted_contacts
    ADD COLUMN question_1_id UUID NOT NULL REFERENCES checkin_questions(id),
    ADD COLUMN question_2_id UUID NOT NULL REFERENCES checkin_questions(id),
    ADD COLUMN question_3_id UUID NOT NULL REFERENCES checkin_questions(id);

-- Les 3 questions d'un contact doivent être distinctes.
ALTER TABLE trusted_contacts
    ADD CONSTRAINT chk_distinct_questions CHECK (
        question_1_id <> question_2_id
        AND question_2_id <> question_3_id
        AND question_1_id <> question_3_id
    );

-- Contrainte non exprimable en CHECK (sous-requête interdite) : les 3
-- questions doivent avoir usage_type IN ('secret_question','both') et
-- reliability_score >= vault.question_min_score. À vérifier en application
-- lors de POST/PUT /transmission/contacts.

CREATE INDEX idx_tcon_q1 ON trusted_contacts(question_1_id);
CREATE INDEX idx_tcon_q2 ON trusted_contacts(question_2_id);
CREATE INDEX idx_tcon_q3 ON trusted_contacts(question_3_id);

-- -----------------------------------------------------------------------------
-- Fix-09a — FK différée checkin_log → journal_entries
--
-- journal_entries est créée en position 14, checkin_log en 12 : la FK ne peut
-- être posée qu'après coup. DEFERRABLE INITIALLY DEFERRED permet d'insérer un
-- check-in avant son entrée de journal dans la même transaction.
-- -----------------------------------------------------------------------------

ALTER TABLE checkin_log
    ADD CONSTRAINT fk_cl_journal
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
    DEFERRABLE INITIALLY DEFERRED;

-- =============================================================================
-- 21. email_log — DEC-24
--
-- Journal de délivrance des emails. Permet au support de diagnostiquer un OTP
-- non reçu (BO-02, cas 2). L'adresse n'est jamais stockée en clair.
-- =============================================================================

CREATE TABLE email_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SET NULL : le log survit à la suppression du compte
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- SHA256(email) — jamais l'adresse en clair
    recipient_hash TEXT NOT NULL CHECK (length(recipient_hash) = 64),

    email_type TEXT NOT NULL CHECK (email_type IN (
        'otp_registration', 'otp_email_change', 'otp_password_reset',
        'checkin_relance_1', 'checkin_relance_2', 'checkin_relance_3',
        'transmission_contact',
        'account_suspended', 'account_unblocked',
        'subscription_expiring', 'subscription_expired'
    )),

    provider_id TEXT, -- ID Resend, pour le tracking de délivrance
    status      TEXT NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent', 'delivered', 'bounced', 'failed')),
    error_message TEXT, -- NULL si succès

    sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_el_user    ON email_log(user_id);
CREATE INDEX idx_el_type    ON email_log(email_type, status);
CREATE INDEX idx_el_sent_at ON email_log(sent_at);
-- Rétention : 90 jours, puis archivage.

-- =============================================================================
-- 22. payment_events — DEC-24
--
-- Historique de facturation. `subscriptions` ne porte que l'état courant :
-- MRR, ARR, churn et revenus cumulés (BO-07) exigent l'historique.
-- =============================================================================

CREATE TABLE payment_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id),

    event_type TEXT NOT NULL CHECK (event_type IN (
        'created',          -- premier abonnement
        'renewed',          -- renouvellement
        'expired',          -- expiration sans renouvellement
        'cancelled',        -- résiliation volontaire
        'grace_started',    -- entrée en période de grâce
        'admin_extended',   -- extension manuelle admin
        'admin_downgraded'  -- rétrogradation admin
    )),

    -- NULL quand l'événement ne porte pas de paiement
    -- (expiration, annulation, entrée en grâce).
    amount_fcfa INT CHECK (amount_fcfa > 0),
    currency    TEXT NOT NULL DEFAULT 'XAF',

    provider_ref TEXT, -- référence mobile money / carte
    notes        TEXT, -- motif admin si admin_extended / admin_downgraded

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pe_user ON payment_events(user_id);
CREATE INDEX idx_pe_type ON payment_events(event_type, created_at);

-- MRR :
--   SELECT SUM(amount_fcfa) / 12 AS mrr_fcfa
--   FROM payment_events
--   WHERE event_type IN ('created', 'renewed')
--     AND created_at >= NOW() - INTERVAL '30 days';

COMMIT;
