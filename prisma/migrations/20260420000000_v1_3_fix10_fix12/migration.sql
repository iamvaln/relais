\set ON_ERROR_STOP on
-- =============================================================================
-- RELAIS — Schéma PostgreSQL v1.2 → v1.3
-- Transcription de specs/Relais_Schema_PostgreSQL_v1.docx (v1.3, patch).
--
--   Fix-10   retrait de l'UPDATE incorrect sur dms.durations_available
--            → déjà non appliqué en v1.2, aucun effet ici
--   Fix-11   checkin_questions : catégories 'shared_memory' et 'other',
--            colonne risk_notes
--   Fix-12a  checkin_questions : UNIQUE partiel sur text_fr et text_en
--   Fix-12b  payment_events : chk_amount_required
--   Fix-12c  checkin_relances : email_log_id remplace les colonnes de
--            délivrance redondantes
--   Fix-12d  app_config : suppression de security.pin_lockout_min
--   Note-01  validation usage_type + min_score dans l'API — pas d'effet ici
-- =============================================================================

-- Atomique : tout ou rien.
BEGIN;

-- -----------------------------------------------------------------------------
-- Fix-11 — checkin_questions : catégories et risk_notes
--
-- 'shared_memory' accueille les questions les mieux notées du seed : celles
-- dont seuls l'owner et ce contact précis connaissent la réponse. 'other'
-- reste le fourre-tout prévu par BO-04.
-- -----------------------------------------------------------------------------

ALTER TABLE checkin_questions
    DROP CONSTRAINT IF EXISTS checkin_questions_category_check;

ALTER TABLE checkin_questions
    ADD CONSTRAINT checkin_questions_category_check CHECK (category IN (
        -- Questions secrètes (contacts)
        'childhood', 'places', 'events', 'people', 'habits',
        'shared_memory', -- mémoires partagées uniques (score 10 potentiel)
        'other',         -- fourre-tout pour questions hors catégorie
        -- Questions carnet de vie
        'month_memory', 'relations', 'work', 'gratitude',
        'introspection', 'legacy', 'lightness'
    ));

ALTER TABLE checkin_questions
    ADD COLUMN IF NOT EXISTS risk_notes TEXT;

COMMENT ON COLUMN checkin_questions.risk_notes IS
    'Notes internes sur les risques identifiés (usage back office uniquement). '
    'Ex : réponse peut changer au fil du temps. Ne jamais afficher aux users.';

-- -----------------------------------------------------------------------------
-- Fix-12a — UNIQUE partiel sur les libellés
--
-- Sans lui, un admin peut créer deux questions au libellé identique avec des
-- UUID différents ; un owner les rattache toutes deux au même contact, et
-- chk_distinct_questions passe alors que le contact n'a que deux questions.
--
-- Partiel : une question archivée peut garder le même libellé que sa
-- reformulation active (remplacement d'une question par une meilleure).
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_cq_text_fr
    ON checkin_questions(text_fr) WHERE status != 'archived';
CREATE UNIQUE INDEX IF NOT EXISTS idx_cq_text_en
    ON checkin_questions(text_en) WHERE status != 'archived';

-- -----------------------------------------------------------------------------
-- Fix-12b — payment_events : le montant est obligatoire quand il y a revenu
--
-- Sans cette contrainte, un 'renewed' sans montant est accepté et disparaît
-- silencieusement du MRR (SUM ignore les NULL).
-- -----------------------------------------------------------------------------

ALTER TABLE payment_events
    ADD CONSTRAINT chk_amount_required CHECK (
        event_type NOT IN ('created', 'renewed') OR amount_fcfa IS NOT NULL
    );

-- -----------------------------------------------------------------------------
-- Fix-12c — checkin_relances : une seule source de vérité pour la délivrance
--
-- Avant : checkin_relances ET email_log portaient provider_id + status pour
-- les mêmes emails. Un webhook Resend devait mettre les deux à jour ; oublier
-- l'un affichait 'sent' quand l'autre disait 'bounced'.
-- Après : checkin_relances pointe vers email_log(id). Une seule mise à jour.
-- -----------------------------------------------------------------------------

ALTER TABLE checkin_relances
    ADD COLUMN email_log_id UUID REFERENCES email_log(id) ON DELETE SET NULL;
    -- SET NULL : le log email est purgé à 90 jours, la relance reste tracée.

ALTER TABLE checkin_relances
    DROP COLUMN IF EXISTS email_provider_id,
    DROP COLUMN IF EXISTS delivery_status;

CREATE INDEX idx_cr_email_log
    ON checkin_relances(email_log_id) WHERE email_log_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Fix-12d — app_config : retrait de la clé morte
--
-- Rendue obsolète par DEC-26 (security.pin_backoff_steps). La conserver
-- laissait aux admins une clé éditable sans aucun effet.
-- -----------------------------------------------------------------------------

DELETE FROM app_config WHERE key = 'security.pin_lockout_min';

-- État final des clés security.* :
--   security.pin_max_attempts    5
--   security.pin_backoff_steps   [30,120,600,1800]   ← DEC-26
--   security.pwd_max_attempts    5
--   security.session_months      3
--   security.otp_validity_min    10
--   security.otp_max_regen_hr    5
--   security.contact_max_fail    5
--   security.contact_lock_hrs    24

-- -----------------------------------------------------------------------------
-- Fix-10 — pour mémoire
--
-- La v1.2 contenait « UPDATE app_config SET value = '3'
-- WHERE key = 'dms.durations_available' », qui contredisait son propre
-- commentaire. Jamais appliqué ici. dms.durations_available reste [1,3,6].
-- -----------------------------------------------------------------------------

COMMIT;
