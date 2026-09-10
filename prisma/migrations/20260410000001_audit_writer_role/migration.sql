\set ON_ERROR_STOP on
-- =============================================================================
-- Immuabilité des audit_logs (Schéma v1.1, table 19)
--
-- Deux couches, indépendantes l'une de l'autre :
--
--   1. Un trigger BEFORE UPDATE OR DELETE qui refuse toute modification, quel
--      que soit le rôle qui l'émet. C'est la garantie de fond : elle ne
--      dépend ni du nom du rôle applicatif, ni de l'ordre des migrations, ni
--      de la configuration de l'hébergeur.
--
--   2. Le rôle audit_writer (INSERT seul) et le REVOKE sur le rôle applicatif,
--      tels que la spec les décrit — défense en profondeur. Le REVOKE ne
--      s'applique que si le rôle `app_user` existe ; adapter au rôle réel
--      créé par l'hébergeur.
--
-- Seul un superuser peut désactiver le trigger, et ce serait une action
-- explicite et traçable — pas une omission silencieuse.
-- =============================================================================

BEGIN;

-- Le DROP … IF EXISTS ci-dessous émet un NOTICE sur base vierge ; inutile.
SET LOCAL client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- 1. Trigger — append-only garanti par la base
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs est append-only : % interdit (id=%)',
        TG_OP, COALESCE(OLD.id::text, '?')
        USING ERRCODE = 'restrict_violation',
              HINT = 'Aucune ligne d''audit ne peut être modifiée ni supprimée.';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- -----------------------------------------------------------------------------
-- 2. Rôles — défense en profondeur, tel que spécifié
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
        CREATE ROLE audit_writer;
    END IF;
END
$$;

GRANT INSERT ON audit_logs TO audit_writer;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        REVOKE UPDATE, DELETE ON audit_logs FROM app_user;
    END IF;
END
$$;

COMMIT;
