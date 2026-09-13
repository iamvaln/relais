\set ON_ERROR_STOP on
-- Smoke test du schéma v1.2 : chaîne de FK complète + contraintes clés.
-- Échoue au premier ASSERT raté (ON_ERROR_STOP) — exit non nul pour la CI.
-- Tout est rollbacké — ne laisse rien en base.
BEGIN;

INSERT INTO admin_users (email, full_name, password_hash, role)
VALUES ('valentine@relais.cm', 'Valentine', '$argon2id$dummy', 'super_admin');

-- 3 questions secrètes distinctes (DEC-20) + 1 question de carnet de vie
-- Libellés préfixés [smoke] : depuis la v1.3, text_fr et text_en sont uniques
-- (idx_cq_text_fr / idx_cq_text_en) — ne jamais entrer en collision avec le seed.
INSERT INTO checkin_questions (text_fr, text_en, category, usage_type, reliability_score)
VALUES ('[smoke] Quel surnom vous donnait votre grand-mère maternelle ?',
        '[smoke] What nickname did your maternal grandmother give you?',
        'childhood', 'secret_question', 9),
       ('[smoke] Dans quelle rue habitait votre oncle maternel ?',
        '[smoke] What street did your maternal uncle live on?',
        'places', 'secret_question', 8),
       ('[smoke] Quel surnom donnez-vous à cette personne ?',
        '[smoke] What nickname do you use for this person?',
        'shared_memory', 'secret_question', 10);

INSERT INTO checkin_questions (text_fr, text_en, category, usage_type, cycle_month)
VALUES ('[smoke] Quel est ton meilleur souvenir de ce mois ?',
        '[smoke] What is your best memory of this month?',
        'month_memory', 'journal', 1);

-- Trois questions secrètes distinctes, choisies de façon déterministe.
-- Tolère une bibliothèque déjà seedée comme une base vide.
CREATE TEMP VIEW secret_qs AS
SELECT (SELECT id FROM checkin_questions WHERE usage_type = 'secret_question'
        ORDER BY text_fr LIMIT 1 OFFSET 0) AS q1,
       (SELECT id FROM checkin_questions WHERE usage_type = 'secret_question'
        ORDER BY text_fr LIMIT 1 OFFSET 1) AS q2,
       (SELECT id FROM checkin_questions WHERE usage_type = 'secret_question'
        ORDER BY text_fr LIMIT 1 OFFSET 2) AS q3;

INSERT INTO users (email, full_name, password_hash, ed25519_pk, account_status, email_verified)
VALUES ('adjoua@example.cm', 'Adjoua N.', '$argon2id$dummy',
        decode(repeat('ab', 32), 'hex'), 'active', true);

INSERT INTO transmission_configs (user_id, status, schema_n, schema_m,
                                  silence_duration_months, checkin_frequency_weeks,
                                  next_checkin_due)
SELECT id, 'active', 2, 3, 3, 4, NOW() + INTERVAL '30 days' FROM users;

-- Deux contacts : A cumule les rôles K1+K2, B n'a que K1.
INSERT INTO trusted_contacts (transmission_id, user_id, contact_order,
                              notification_enc, notification_sig, notification_hash,
                              secret_enc, has_k1_role, has_k2_role,
                              storj_k1_path, storj_k2_path,
                              share_k1_hash, share_k2_hash,
                              question_1_id, question_2_id, question_3_id)
SELECT tc.id, u.id, 1,
       '\x01'::bytea, '\x02'::bytea, repeat('a', 64),
       '\x03'::bytea, true, true,
       'shares/'||u.id||'/c1_k1.enc', 'shares/'||u.id||'/c1_k2.enc',
       repeat('b', 64), repeat('c', 64),
       q.q1, q.q2, q.q3
FROM transmission_configs tc JOIN users u ON u.id = tc.user_id, secret_qs q;

INSERT INTO trusted_contacts (transmission_id, user_id, contact_order,
                              notification_enc, notification_sig, notification_hash,
                              secret_enc, has_k1_role, storj_k1_path, share_k1_hash,
                              question_1_id, question_2_id, question_3_id)
SELECT tc.id, u.id, 2,
       '\x01'::bytea, '\x02'::bytea, repeat('d', 64),
       '\x03'::bytea, true, 'shares/'||u.id||'/c2_k1.enc', repeat('e', 64),
       q.q3, q.q1, q.q2
FROM transmission_configs tc JOIN users u ON u.id = tc.user_id, secret_qs q;

INSERT INTO checkin_log (user_id, transmission_id, checkin_month, question_id,
                         game_type, game_completed_at, streak_at_checkin)
SELECT u.id, tc.id, date_trunc('month', NOW())::date, q.id, 'riddle', NOW(), 1
FROM users u JOIN transmission_configs tc ON tc.user_id = u.id
CROSS JOIN (SELECT id FROM checkin_questions WHERE usage_type = 'journal'
            ORDER BY cycle_month, text_fr LIMIT 1) q;

INSERT INTO journal_entries (user_id, entry_month, mode, content_enc, word_count_approx)
SELECT id, date_trunc('month', NOW())::date, 'essential', '\xdeadbeef'::bytea, 120 FROM users;

-- Déclenchement du DMS
INSERT INTO transmissions (transmission_config_id, user_id, escrow_expires_at,
                           schema_n_snapshot, schema_m_snapshot)
SELECT tc.id, tc.user_id, NOW() + INTERVAL '72 hours', tc.schema_n, tc.schema_m
FROM transmission_configs tc;

INSERT INTO transmission_contacts (transmission_id, trusted_contact_id,
                                   relay_token_hash, relay_token_expires_at)
SELECT t.id, c.id, repeat(lpad(c.contact_order::text, 2, '0'), 32), NOW() + INTERVAL '72 hours'
FROM transmissions t JOIN trusted_contacts c ON c.user_id = t.user_id;

INSERT INTO escrow_shares (transmission_id, transmission_contact_id, key_category,
                           share_tmp_enc, redis_key_id, expires_at)
SELECT tc.transmission_id, tc.id, 'k1', '\xcafe'::bytea,
       'escrow_key:'||tc.id, NOW() + INTERVAL '72 hours'
FROM transmission_contacts tc;

INSERT INTO audit_logs (action, target_type, ip_hash)
VALUES ('ADMIN_LOGIN', 'admin', repeat('f', 64));

-- Vérifications
DO $$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM trusted_contacts;      ASSERT n = 2, 'contacts';
    SELECT count(*) INTO n FROM transmission_contacts; ASSERT n = 2, 'relay tokens';
    SELECT count(*) INTO n FROM escrow_shares;         ASSERT n = 2, 'escrow';
END $$;

-- Un contact sans aucun rôle doit être refusé (chk_roles)
DO $$
BEGIN
    BEGIN
        INSERT INTO trusted_contacts (transmission_id, user_id, contact_order,
                                      notification_enc, notification_sig,
                                      notification_hash, secret_enc,
                                      question_1_id, question_2_id, question_3_id)
        SELECT tc.id, tc.user_id, 3, '\x01'::bytea, '\x02'::bytea, repeat('9', 64), '\x03'::bytea,
               q.q1, q.q2, q.q3
        FROM transmission_configs tc, secret_qs q;
        RAISE EXCEPTION 'chk_roles aurait dû rejeter un contact sans rôle';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

-- schema_m >= schema_n
DO $$
BEGIN
    BEGIN
        UPDATE transmission_configs SET schema_n = 5;
        RAISE EXCEPTION 'schema_m >= schema_n aurait dû être violé';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

-- Un seul check-in par mois et par user
DO $$
BEGIN
    BEGIN
        INSERT INTO checkin_log (user_id, transmission_id, checkin_month,
                                 game_type, game_completed_at, streak_at_checkin)
        SELECT u.id, tc.id, date_trunc('month', NOW())::date, 'puzzle', NOW(), 2
        FROM users u JOIN transmission_configs tc ON tc.user_id = u.id;
        RAISE EXCEPTION 'idx_cl_user_month aurait dû rejeter le doublon';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END $$;

-- Une seule part par contact et par catégorie
DO $$
BEGIN
    BEGIN
        INSERT INTO escrow_shares (transmission_id, transmission_contact_id, key_category,
                                   share_tmp_enc, redis_key_id, expires_at)
        SELECT tc.transmission_id, tc.id, 'k1', '\xbeef'::bytea, 'dup', NOW()
        FROM transmission_contacts tc LIMIT 1;
        RAISE EXCEPTION 'idx_es_contact_category aurait dû rejeter le doublon';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END $$;

-- Email invalide refusé
DO $$
BEGIN
    BEGIN
        INSERT INTO users (email, full_name, password_hash) VALUES ('pas-un-email', 'X', 'y');
        RAISE EXCEPTION 'le CHECK email aurait dû rejeter la valeur';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;


-- ---------------------------------------------------------------------------
-- audit_logs est append-only par trigger — indépendamment du rôle.
-- Ce test tourne en superuser : si ça échoue ici, ça échoue pour tout le monde.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        UPDATE audit_logs SET reason = 'falsifié';
        RAISE EXCEPTION 'trg_audit_logs_immutable aurait dû refuser l''UPDATE';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;
    BEGIN
        DELETE FROM audit_logs;
        RAISE EXCEPTION 'trg_audit_logs_immutable aurait dû refuser le DELETE';
    EXCEPTION WHEN restrict_violation THEN NULL;
    END;
END $$;

-- ---------------------------------------------------------------------------
-- v1.2 — DEC-20 : les 3 questions d'un contact doivent être distinctes
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        INSERT INTO trusted_contacts (transmission_id, user_id, contact_order,
                                      notification_enc, notification_sig,
                                      notification_hash, secret_enc, has_k1_role,
                                      question_1_id, question_2_id, question_3_id)
        SELECT tc.id, tc.user_id, 4, '\x01'::bytea, '\x02'::bytea, repeat('8', 64),
               '\x03'::bytea, true, q.q1, q.q1, q.q3
        FROM transmission_configs tc, secret_qs q;
        RAISE EXCEPTION 'chk_distinct_questions aurait dû rejeter deux questions identiques';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

-- ---------------------------------------------------------------------------
-- v1.2 — DEC-22 : silence_duration_months vaut 3 par défaut
-- ---------------------------------------------------------------------------
DO $$
DECLARE v INT;
BEGIN
    SELECT column_default::INT INTO v
    FROM information_schema.columns
    WHERE table_name = 'transmission_configs' AND column_name = 'silence_duration_months';
    ASSERT v = 3, 'silence_duration_months devrait valoir 3 par défaut, vaut ' || v;
END $$;

-- ---------------------------------------------------------------------------
-- v1.2 — Fix-09a : la FK checkin_log → journal_entries est différée.
-- Insérer le check-in AVANT son entrée de journal doit passer dans la même tx.
-- ---------------------------------------------------------------------------
DO $$
DECLARE jid UUID := gen_random_uuid();
BEGIN
    INSERT INTO checkin_log (user_id, transmission_id, checkin_month, journal_entry_id,
                             game_type, game_completed_at, streak_at_checkin)
    SELECT u.id, tc.id, (date_trunc('month', NOW()) - INTERVAL '1 month')::date, jid,
           'puzzle', NOW(), 2
    FROM users u JOIN transmission_configs tc ON tc.user_id = u.id;

    -- L'entrée de journal n'existe pas encore : sans DEFERRABLE, l'INSERT
    -- ci-dessus aurait déjà échoué.
    INSERT INTO journal_entries (id, user_id, entry_month, mode, content_enc)
    SELECT jid, id, (date_trunc('month', NOW()) - INTERVAL '1 month')::date,
           'reflective', '\xfeed'::bytea
    FROM users;
END $$;

-- Une FK différée reste vérifiée en fin de transaction.
DO $$
BEGIN
    BEGIN
        INSERT INTO checkin_log (user_id, transmission_id, checkin_month, journal_entry_id,
                                 game_type, game_completed_at, streak_at_checkin)
        SELECT u.id, tc.id, (date_trunc('month', NOW()) - INTERVAL '2 month')::date,
               gen_random_uuid(), 'sort', NOW(), 3
        FROM users u JOIN transmission_configs tc ON tc.user_id = u.id;
        SET CONSTRAINTS fk_cl_journal IMMEDIATE;
        RAISE EXCEPTION 'fk_cl_journal aurait dû rejeter un journal_entry_id inexistant';
    EXCEPTION WHEN foreign_key_violation THEN
        SET CONSTRAINTS fk_cl_journal DEFERRED;
    END;
END $$;

-- ---------------------------------------------------------------------------
-- v1.2 — DEC-24 : email_log et payment_events
-- ---------------------------------------------------------------------------
INSERT INTO email_log (user_id, recipient_hash, email_type, provider_id, status)
SELECT id, encode(sha256(email::bytea), 'hex'), 'otp_registration', 're_abc123', 'delivered'
FROM users;

INSERT INTO subscriptions (user_id, plan, status, expires_at, price_fcfa)
SELECT id, 'premium', 'active', NOW() + INTERVAL '1 year', 10000 FROM users;

INSERT INTO payment_events (user_id, subscription_id, event_type, amount_fcfa, provider_ref)
SELECT s.user_id, s.id, 'created', 10000, 'momo_xyz' FROM subscriptions s;
-- Un événement sans paiement : amount_fcfa NULL
INSERT INTO payment_events (user_id, subscription_id, event_type)
SELECT s.user_id, s.id, 'grace_started' FROM subscriptions s;

-- amount_fcfa doit rester strictement positif quand il est renseigné
DO $$
BEGIN
    BEGIN
        INSERT INTO payment_events (user_id, subscription_id, event_type, amount_fcfa)
        SELECT s.user_id, s.id, 'renewed', 0 FROM subscriptions s;
        RAISE EXCEPTION 'amount_fcfa > 0 aurait dû être violé';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

-- Le calcul MRR de BO-07 tourne
DO $$
DECLARE mrr NUMERIC;
BEGIN
    SELECT COALESCE(SUM(amount_fcfa), 0) / 12.0 INTO mrr
    FROM payment_events
    WHERE event_type IN ('created', 'renewed')
      AND created_at >= NOW() - INTERVAL '30 days';
    ASSERT mrr > 0, 'le MRR devrait être positif';
END $$;

-- ---------------------------------------------------------------------------
-- v1.3 — Fix-12a : deux questions actives au même libellé sont refusées
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        INSERT INTO checkin_questions (text_fr, text_en, category, usage_type)
        VALUES ('[smoke] Quel surnom vous donnait votre grand-mère maternelle ?',
                '[smoke] doublon EN', 'childhood', 'secret_question');
        RAISE EXCEPTION 'idx_cq_text_fr aurait dû rejeter un libellé FR en double';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END $$;

-- …mais une question archivée peut garder le libellé de sa remplaçante
DO $$
DECLARE archived_id UUID;
BEGIN
    INSERT INTO checkin_questions (text_fr, text_en, category, usage_type, status)
    VALUES ('[smoke] ancienne formulation', '[smoke] old wording', 'other', 'secret_question', 'archived')
    RETURNING id INTO archived_id;
    INSERT INTO checkin_questions (text_fr, text_en, category, usage_type)
    VALUES ('[smoke] ancienne formulation', '[smoke] old wording', 'other', 'secret_question');
    -- Fix-11 : 'other' et risk_notes existent
    UPDATE checkin_questions SET risk_notes = 'test' WHERE id = archived_id;
END $$;

-- ---------------------------------------------------------------------------
-- v1.3 — Fix-12b : un événement générateur de revenu sans montant est refusé
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        INSERT INTO payment_events (user_id, subscription_id, event_type)
        SELECT s.user_id, s.id, 'renewed' FROM subscriptions s;
        RAISE EXCEPTION 'chk_amount_required aurait dû rejeter un renewed sans montant';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

-- ---------------------------------------------------------------------------
-- v1.3 — Fix-12c : une relance pointe vers son email_log, et survit à sa purge
-- ---------------------------------------------------------------------------
DO $$
DECLARE log_id UUID; n INT;
BEGIN
    INSERT INTO email_log (user_id, recipient_hash, email_type, provider_id, status)
    SELECT id, encode(sha256(email::bytea), 'hex'), 'checkin_relance_1', 're_rel1', 'sent'
    FROM users RETURNING id INTO log_id;

    INSERT INTO checkin_relances (user_id, transmission_id, relance_number, email_log_id)
    SELECT u.id, tc.id, 1, log_id
    FROM users u JOIN transmission_configs tc ON tc.user_id = u.id;

    -- Le webhook ne met à jour QUE email_log : la relance lit le statut par la FK
    UPDATE email_log SET status = 'bounced' WHERE id = log_id;
    SELECT count(*) INTO n FROM checkin_relances r JOIN email_log e ON e.id = r.email_log_id
    WHERE e.status = 'bounced';
    ASSERT n = 1, 'la relance devrait lire bounced via email_log';

    -- Purge du log (rétention 90j) : la relance reste, email_log_id passe à NULL
    DELETE FROM email_log WHERE id = log_id;
    SELECT count(*) INTO n FROM checkin_relances WHERE email_log_id IS NULL;
    ASSERT n = 1, 'checkin_relances.email_log_id devrait être NULL après purge';
END $$;

-- ---------------------------------------------------------------------------
-- v1.3 — Fix-12d : la clé morte a disparu, la clé DEC-26 est là
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM app_config WHERE key = 'security.pin_lockout_min';
    ASSERT n = 0, 'security.pin_lockout_min devrait avoir été supprimée';
    SELECT count(*) INTO n FROM app_config WHERE key = 'security.pin_backoff_steps';
    ASSERT n = 1, 'security.pin_backoff_steps devrait exister';
END $$;

-- ---------------------------------------------------------------------------
-- Lot 2a (13/09/2026) — miroir Arbitrum : chain_subject, chain_registered_at,
-- table chain_sync ; arbitrum_address (jamais lue) a disparu
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM information_schema.columns
     WHERE table_name = 'transmission_configs' AND column_name IN ('chain_subject', 'chain_registered_at');
    ASSERT n = 2, 'transmission_configs.chain_subject et chain_registered_at devraient exister';
    SELECT count(*) INTO n FROM information_schema.columns
     WHERE table_name = 'transmission_configs' AND column_name = 'arbitrum_address';
    ASSERT n = 0, 'transmission_configs.arbitrum_address devrait avoir disparu';
    SELECT count(*) INTO n FROM information_schema.tables WHERE table_name = 'chain_sync';
    ASSERT n = 1, 'chain_sync devrait exister';
    -- statut contraint
    BEGIN
        INSERT INTO chain_sync (subject, action, status) VALUES ('0x' || repeat('a', 64), 'checkin', 'bizarre');
        RAISE EXCEPTION 'chain_sync.status devrait être contraint';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO chain_sync (subject, action, status, tx_hash) VALUES ('0x' || repeat('a', 64), 'checkin', 'confirmed', '0x' || repeat('b', 64));
    SELECT count(*) INTO n FROM chain_sync WHERE status = 'confirmed';
    ASSERT n = 1, 'chain_sync insérée';
END $$;

-- ---------------------------------------------------------------------------
-- Suppression du user : cascade sur toute la chaîne
DELETE FROM payment_events;
DELETE FROM escrow_shares;
DELETE FROM transmission_contacts;
DELETE FROM transmissions;
DELETE FROM users;
DO $$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM trusted_contacts;      ASSERT n = 0, 'cascade contacts';
    SELECT count(*) INTO n FROM transmission_configs;  ASSERT n = 0, 'cascade configs';
    SELECT count(*) INTO n FROM journal_entries;       ASSERT n = 0, 'cascade journal';
    SELECT count(*) INTO n FROM audit_logs;            ASSERT n = 1, 'audit survit';
    -- email_log : ON DELETE SET NULL — la ligne survit, sans user_id
    SELECT count(*) INTO n FROM email_log;             ASSERT n = 1, 'email_log survit';
    SELECT count(*) INTO n FROM email_log WHERE user_id IS NULL;
    ASSERT n = 1, 'email_log.user_id devrait être NULL après suppression';
END $$;

ROLLBACK;
