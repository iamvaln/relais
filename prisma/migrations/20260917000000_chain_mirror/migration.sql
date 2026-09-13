-- =============================================================================
-- Lot 2a Arbitrum v2 (13/09/2026) — le miroir on-chain (docs/smart-contract-v2.md §3).
--
-- transmission_configs
--   chain_subject        : keccak256(users.ed25519_pk), hex 0x — l'identité on-chain,
--                          posée au premier enregistrement ; jamais un user_id.
--   chain_registered_at  : date du `register` confirmé sur la chaîne.
--   arbitrum_address     : colonne du schéma v1 jamais lue ni écrite — supprimée
--                          (le design v2 la remplace par chain_subject).
--
-- chain_sync : la file ET le journal des écritures relayées (une ligne par
-- appel, traitée dans l'ordre par sujet par le worker `chain:drain`). Sujet,
-- action, arguments on-chain, hash de transaction et message d'erreur
-- technique : aucune donnée utilisateur, aucun blob.
-- =============================================================================

ALTER TABLE transmission_configs DROP COLUMN IF EXISTS arbitrum_address;
ALTER TABLE transmission_configs
    ADD COLUMN chain_subject       TEXT CHECK (chain_subject ~ '^0x[0-9a-f]{64}$'),
    ADD COLUMN chain_registered_at TIMESTAMPTZ;
CREATE INDEX idx_tc_chain_subject ON transmission_configs (chain_subject) WHERE chain_subject IS NOT NULL;

CREATE TABLE chain_sync (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject      TEXT NOT NULL CHECK (subject ~ '^0x[0-9a-f]{64}$'),
    action       TEXT NOT NULL CHECK (action IN ('register', 'setShareHashes', 'checkin', 'pause', 'resume', 'cancelTrigger', 'deactivate', 'trigger', 'complete', 'setPointers')),
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'confirmed', 'skipped', 'failed')),
    -- arguments de l'appel (dates en secondes, hex, signature owner) : rien d'autre que ce qui part on-chain
    args         JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- contexte pour les suites (chain_registered_at, checkin_log.arbitrum_tx_hash, transmissions.arbitrum_trigger_block)
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    ref_id       UUID,
    tx_hash      TEXT CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    block_number BIGINT,
    attempts     INT  NOT NULL DEFAULT 0,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cs_subject ON chain_sync (subject, created_at DESC);
CREATE INDEX idx_cs_status  ON chain_sync (status) WHERE status IN ('queued', 'sent', 'failed');
