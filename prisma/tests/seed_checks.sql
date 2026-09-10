\set ON_ERROR_STOP on
-- Vérifie que la bibliothèque seedée respecte les règles des specs.
-- Lecture seule — ne modifie rien.

DO $$
DECLARE n INT; m INT;
BEGIN
    -- BO-04 : la bibliothèque compte 50 à 200 questions
    SELECT count(*) INTO n FROM checkin_questions;
    ASSERT n BETWEEN 50 AND 200, 'la bibliothèque devrait compter 50-200 questions, en compte ' || n;

    -- vault.question_min_score = 6 : rien en dessous ne doit être proposable.
    -- STRICT : si la clé de config manque, on échoue au lieu de comparer à
    -- NULL, ce qui rendrait l'assertion vraie par défaut.
    SELECT value::INT INTO STRICT m FROM app_config WHERE key = 'vault.question_min_score';
    SELECT count(*) INTO n FROM checkin_questions
    WHERE usage_type IN ('secret_question','both')
      AND status = 'active'
      AND reliability_score < m;
    ASSERT n = 0, n || ' question(s) secrète(s) active(s) sous le score minimum ' || m;

    -- vault.questions_per_contact = 3 : il faut de quoi choisir 3 questions
    -- distinctes, et largement plus pour que le choix ait un sens
    SELECT count(*) INTO n FROM checkin_questions
    WHERE usage_type IN ('secret_question','both') AND status = 'active';
    SELECT value::INT INTO STRICT m FROM app_config WHERE key = 'vault.questions_per_contact';
    ASSERT n >= m, 'moins de ' || m || ' questions secrètes disponibles';
    ASSERT n >= 20, 'seulement ' || n || ' questions secrètes — choix trop pauvre';

    -- E2-US07 : une question de carnet par mois, dans chaque mode
    SELECT count(DISTINCT cycle_month) INTO n FROM checkin_questions
    WHERE usage_type IN ('journal','both') AND status = 'active' AND cycle_month IS NOT NULL;
    ASSERT n = 12, 'le cycle annuel du carnet couvre ' || n || ' mois sur 12';

    SELECT count(*) INTO n FROM (
        SELECT cycle_month FROM checkin_questions
        WHERE usage_type = 'journal' AND mode_target = 'essential' AND cycle_month IS NOT NULL
        GROUP BY cycle_month
    ) x;
    ASSERT n = 12, 'mode essential : ' || n || ' mois couverts sur 12';

    SELECT count(*) INTO n FROM (
        SELECT cycle_month FROM checkin_questions
        WHERE usage_type = 'journal' AND mode_target = 'reflective' AND cycle_month IS NOT NULL
        GROUP BY cycle_month
    ) x;
    ASSERT n = 12, 'mode reflective : ' || n || ' mois couverts sur 12';

    -- Toute question doit être bilingue et non vide (Dossier Produit : FR/EN dès V1)
    SELECT count(*) INTO n FROM checkin_questions
    WHERE btrim(text_fr) = '' OR btrim(text_en) = '' OR text_fr = text_en;
    ASSERT n = 0, n || ' question(s) sans traduction exploitable';

    -- Pas de doublon de libellé : deux questions identiques rendraient
    -- chk_distinct_questions contournable côté UX
    SELECT count(*) INTO n FROM (
        SELECT text_fr FROM checkin_questions GROUP BY text_fr HAVING count(*) > 1
    ) x;
    ASSERT n = 0, n || ' libellé(s) FR en double';

    SELECT count(*) INTO n FROM (
        SELECT text_en FROM checkin_questions GROUP BY text_en HAVING count(*) > 1
    ) x;
    ASSERT n = 0, n || ' libellé(s) EN en double';

    -- Une question de carnet n'a pas à être rattachable à un contact,
    -- et une question secrète n'a pas de place dans le cycle annuel
    SELECT count(*) INTO n FROM checkin_questions
    WHERE usage_type = 'secret_question' AND cycle_month IS NOT NULL;
    ASSERT n = 0, n || ' question(s) secrète(s) placée(s) dans le cycle annuel';

    SELECT count(*) INTO n FROM checkin_questions
    WHERE usage_type = 'journal' AND cycle_month IS NULL;
    ASSERT n = 0, n || ' question(s) de carnet sans mois de cycle';

    -- BO-04 + Fix-11 : les 6 catégories de questions secrètes sont couvertes
    SELECT count(DISTINCT category) INTO n FROM checkin_questions
    WHERE usage_type = 'secret_question'
      AND category IN ('childhood','places','events','people','habits','shared_memory');
    ASSERT n = 6, 'seulement ' || n || ' catégories de questions secrètes couvertes sur 6';

    -- Les questions de mémoire partagée sont bien dans leur catégorie (Fix-11)
    SELECT count(*) INTO n FROM checkin_questions WHERE category = 'shared_memory';
    ASSERT n >= 3, 'la catégorie shared_memory devrait compter au moins 3 questions';
END $$;

-- Un contact réel peut être créé avec 3 questions issues de la bibliothèque :
-- c'est la vérification qui compte, puisque DEC-20 rend question_*_id NOT NULL.
DO $$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM (
        SELECT id FROM checkin_questions
        WHERE usage_type IN ('secret_question','both')
          AND status = 'active'
          AND reliability_score >= 6
        LIMIT 3
    ) x;
    ASSERT n = 3, 'impossible de composer 3 questions secrètes valides';
END $$;
