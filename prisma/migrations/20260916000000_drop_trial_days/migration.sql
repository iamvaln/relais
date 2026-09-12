-- =============================================================================
-- Points ouverts (12/09/2026) — billing.trial_days retiré de app_config.
-- La clé (BO-05, défaut 0) n'avait aucune règle derrière elle : rien ne
-- disait ce qu'un essai débloque ni comment il finit, et l'API ne la lisait
-- pas. Visible dans le back office, elle laissait croire qu'un essai gratuit
-- existait. Elle reviendra avec une règle, le jour où le produit en veut une.
-- =============================================================================

DELETE FROM app_config WHERE key = 'billing.trial_days';
