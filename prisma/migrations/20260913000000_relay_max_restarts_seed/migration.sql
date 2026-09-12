-- Schéma v1.5 / D.4 (Proposal-9) : le plafond de redémarrage du relay devient
-- une ligne de configuration visible dans BO-05. L'API la lisait déjà avec un
-- repli à 3 (jobs/relay-cleanup.ts, admin/dashboard.ts) ; la ligne rend la
-- valeur administrable. Idempotent : ne touche pas une valeur déjà posée.

INSERT INTO app_config (key, value, config_type, category, description) VALUES
    ('dms.relay_max_restarts', '3', 'int', 'dms', 'Max expirations d''escrow avant alerte transmission_stalled (BO-01)')
ON CONFLICT (key) DO NOTHING;
