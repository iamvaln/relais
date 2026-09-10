-- =============================================================================
-- Immuabilité des audit_logs (Schéma v1.1, table 19)
--
-- Séparé de la migration initiale : la création de rôles est idempotente
-- ici et dépend du rôle applicatif, dont le nom varie selon l'hébergeur.
-- Adapter `app_user` au rôle réellement utilisé par l'API.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
        CREATE ROLE audit_writer;
    END IF;
END
$$;

GRANT INSERT ON audit_logs TO audit_writer;

-- Le rôle principal de l'application ne doit jamais pouvoir modifier ni
-- supprimer une ligne d'audit. Sans ce REVOKE, « log immuable » n'est
-- qu'une intention.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        REVOKE UPDATE, DELETE ON audit_logs FROM app_user;
    END IF;
END
$$;
