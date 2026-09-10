-- Smoke test du schéma v1.1 : chaîne de FK complète + contraintes clés.
-- Tout est rollbacké — ne laisse rien en base.
BEGIN;

INSERT INTO admin_users (email, full_name, password_hash, role)
VALUES ('valentine@relais.cm', 'Valentine', '$argon2id$dummy', 'super_admin');

-- 3 questions secrètes distinctes (DEC-20) + 1 question de carnet de vie
INSERT INTO checkin_questions (text_fr, text_en, category, usage_type, reliability_score)
VALUES ('Quel surnom vous donnait votre grand-mère maternelle ?',
        'What nickname did your maternal grandmother give you?',
        'childhood', 'secret_question', 9),
       ('Dans quelle rue habitait votre oncle maternel quand vous étiez enfant ?',
        'What street did your maternal uncle live on when you were a child?',
        'places', 'secret_question', 8),
       ('Quel film regardiez-vous en boucle avec votre père ?',
        'What film did you watch on repeat with your father?',
        'events', 'secret_question', 9);

INSERT INTO checkin_questions (text_fr, text_en, category, usage_type, cycle_month)
VALUES ('Quel est ton meilleur souvenir de ce mois ?',
        'What is your best memory of this month?',
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
