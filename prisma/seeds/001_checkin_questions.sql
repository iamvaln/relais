-- =============================================================================
-- RELAIS — Seed : bibliothèque checkin_questions
--
-- Deux jeux dans une même table, distingués par usage_type :
--   secret_question — proposées à l'owner pour ses trusted contacts (BO-04)
--   journal         — question du mois du carnet de vie (E2-US07)
--
-- BLOQUANT : depuis DEC-20, trusted_contacts.question_1/2/3_id est NOT NULL.
-- Aucun trusted contact ne peut être créé tant que ce seed n'a pas tourné.
--
-- Idempotent : chaque ligne est insérée uniquement si son text_fr est absent.
-- Rejouer ce fichier est sans effet ; y ajouter des questions et le rejouer
-- n'insère que les nouvelles. Depuis la v1.3, idx_cq_text_fr garantit en plus
-- qu'aucun doublon ne peut passer, seed ou back office.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Questions secrètes
--
-- Grille de notation BO-04 :
--   9-10  stable, privée, précise, non devinable, non publique
--   7-8   stable et privée, légère ambiguïté possible sur la formulation
--   6     réponse stable mais potentiellement connue d'un cercle plus large
--
-- Seules les questions >= vault.question_min_score (6) sont proposées, donc
-- rien n'est seedé en dessous de 6. Les critères appliqués à chaque question :
-- réponse stable dans le temps, connue du seul contact ciblé, univoque (un nom
-- ou un mot, pas une phrase), absente des réseaux sociaux et des documents
-- officiels.
--
-- Les questions de mémoire partagée sont les plus solides : seuls l'owner et
-- ce contact précis connaissent la réponse. Elles ont leur catégorie depuis
-- la v1.3 du schéma (Fix-11 : 'shared_memory').
-- -----------------------------------------------------------------------------

INSERT INTO checkin_questions (text_fr, text_en, category, usage_type, reliability_score)
SELECT v.text_fr, v.text_en, v.category, 'secret_question', v.score
FROM (VALUES
    -- Enfance ---------------------------------------------------------------
    ('Quel surnom votre grand-mère maternelle vous donnait-elle ?',
     'What nickname did your maternal grandmother call you?', 'childhood', 9),
    ('Quel était le prénom de votre meilleur(e) ami(e) en classe de 6e ?',
     'What was the first name of your best friend in your first year of secondary school?', 'childhood', 9),
    ('Quel objet emportiez-vous partout quand vous étiez enfant ?',
     'What object did you carry everywhere as a child?', 'childhood', 8),
    ('Comment s''appelait l''animal domestique de votre enfance ?',
     'What was the name of your childhood pet?', 'childhood', 8),
    ('Quel est le premier plat que vous avez appris à cuisiner seul(e) ?',
     'What was the first dish you learned to cook on your own?', 'childhood', 8),
    ('Quelle punition receviez-vous le plus souvent enfant ?',
     'What punishment did you receive most often as a child?', 'childhood', 7),
    ('Quel est le nom de la première école que vous avez fréquentée ?',
     'What is the name of the first school you attended?', 'childhood', 6),

    -- Lieux -----------------------------------------------------------------
    ('Dans quelle rue habitait votre oncle maternel quand vous étiez enfant ?',
     'What street did your maternal uncle live on when you were a child?', 'places', 9),
    ('Dans quel quartier se trouvait votre premier logement indépendant ?',
     'What neighbourhood was your first place of your own in?', 'places', 8),
    ('Quel est le nom du marché où votre mère faisait ses courses ?',
     'What is the name of the market where your mother did her shopping?', 'places', 8),
    ('Dans quel quartier avez-vous passé vos vacances quand vous aviez dix ans ?',
     'What neighbourhood did you spend your holidays in when you were ten?', 'places', 8),
    ('Quelle est la première ville où vous avez voyagé seul(e) ?',
     'What was the first city you travelled to alone?', 'places', 7),
    ('Quel est le nom du village d''origine de votre père ?',
     'What is the name of your father''s home village?', 'places', 6),

    -- Événements ------------------------------------------------------------
    ('Quel film regardiez-vous en boucle avec votre père enfant ?',
     'What film did you watch on repeat with your father as a child?', 'events', 9),
    ('Quelle était la destination de votre premier voyage en avion ?',
     'What was the destination of your first flight?', 'events', 8),
    ('Quel est le premier concert auquel vous avez assisté ?',
     'What was the first concert you attended?', 'events', 8),
    ('Quel a été votre premier emploi rémunéré ?',
     'What was your first paid job?', 'events', 7),

    -- Personnes -------------------------------------------------------------
    ('Comment s''appelait votre professeur principal en classe de 3e ?',
     'What was the name of your form teacher in your fourth year of secondary school?', 'people', 8),
    ('Quel est le prénom de la personne qui vous a appris à conduire ?',
     'What is the first name of the person who taught you to drive?', 'people', 8),
    ('Quel est le prénom du voisin qui vous gardait enfant ?',
     'What is the first name of the neighbour who looked after you as a child?', 'people', 8),
    ('Comment surnommiez-vous votre meilleur ami au lycée ?',
     'What did you call your best friend in your final years of school?', 'people', 8),
    ('Quel est le prénom de votre premier patron ?',
     'What is the first name of your first boss?', 'people', 7),

    -- Habitudes -------------------------------------------------------------
    ('Quel plat votre mère préparait-elle pour votre anniversaire ?',
     'What dish did your mother make for your birthday?', 'habits', 9),
    ('Quelle chanson chantiez-vous toujours en famille ?',
     'What song did your family always sing together?', 'habits', 8),
    ('Quelle boisson commandez-vous systématiquement quand vous sortez ?',
     'What drink do you always order when you go out?', 'habits', 7),
    ('Quel est le trajet que vous faisiez tous les jours pour aller travailler il y a dix ans ?',
     'What was your daily commute ten years ago?', 'habits', 7),

    -- Mémoire partagée avec le contact — les plus solides -------------------
    ('Quel surnom donnez-vous à cette personne, que personne d''autre n''utilise ?',
     'What nickname do you use for this person that nobody else uses?', 'shared_memory', 10),
    ('Quel est le premier voyage que vous avez fait tous les deux ?',
     'What was the first trip the two of you took together?', 'shared_memory', 9),
    ('Quel plat avez-vous partagé le plus souvent avec cette personne ?',
     'What dish have you shared most often with this person?', 'shared_memory', 9),
    ('Quel objet cette personne vous a-t-elle offert et que vous avez gardé ?',
     'What object did this person give you that you kept?', 'shared_memory', 8),
    ('Dans quelle ville vous êtes-vous vus pour la dernière fois avant aujourd''hui ?',
     'In what city did you last see each other?', 'shared_memory', 7)
) AS v(text_fr, text_en, category, score)
WHERE NOT EXISTS (
    SELECT 1 FROM checkin_questions q WHERE q.text_fr = v.text_fr
);

-- -----------------------------------------------------------------------------
-- 2. Questions du carnet de vie
--
-- Un cycle annuel : une question par mois et par mode. `mode_target` indique
-- dans quel mode la question est proposée (journal_entries.mode vaut
-- 'essential', 'reflective' ou 'free' — 'free' étant l'écriture libre, sans
-- question).
--
-- Le tutoiement est volontaire : ce sont les mots de l'utilisateur pour ses
-- proches, pas ceux de la plateforme. Les questions secrètes ci-dessus
-- vouvoient, elles, car ce sont des questions de vérification d'identité.
--
-- reliability_score n'a pas de sens ici (il ne sert qu'au scoring des
-- questions secrètes) : le DEFAULT 7 s'applique et n'est jamais lu.
-- -----------------------------------------------------------------------------

INSERT INTO checkin_questions (text_fr, text_en, category, usage_type, cycle_month, mode_target)
SELECT v.text_fr, v.text_en, v.category, 'journal', v.cycle_month, v.mode_target
FROM (VALUES
    -- Janvier ---------------------------------------------------------------
    ('Qu''est-ce que tu veux faire différemment cette année ?',
     'What do you want to do differently this year?', 'introspection', 1, 'essential'),
    ('Si cette année devait t''apprendre une seule chose, laquelle aimerais-tu que ce soit ?',
     'If this year were to teach you one thing, what would you want it to be?', 'introspection', 1, 'reflective'),

    -- Février ---------------------------------------------------------------
    ('Qui t''a fait du bien ce mois-ci ?',
     'Who did you good this month?', 'relations', 2, 'essential'),
    ('À qui n''as-tu jamais dit à quel point il ou elle comptait pour toi ?',
     'Who have you never told how much they mattered to you?', 'relations', 2, 'reflective'),

    -- Mars ------------------------------------------------------------------
    ('De quoi es-tu le plus fier dans ton travail en ce moment ?',
     'What are you proudest of in your work right now?', 'work', 3, 'essential'),
    ('Si tu pouvais recommencer ta carrière, qu''est-ce que tu referais pareil ?',
     'If you could start your career over, what would you do the same way?', 'work', 3, 'reflective'),

    -- Avril -----------------------------------------------------------------
    ('Pour quoi as-tu dit merci ce mois-ci ?',
     'What did you say thank you for this month?', 'gratitude', 4, 'essential'),
    ('Quelle chance as-tu eue que tu n''as jamais vraiment reconnue ?',
     'What luck have you had that you never really acknowledged?', 'gratitude', 4, 'reflective'),

    -- Mai -------------------------------------------------------------------
    ('Quel est ton meilleur souvenir de ce mois ?',
     'What is your best memory of this month?', 'month_memory', 5, 'essential'),
    ('Quel moment de ce mois voudrais-tu revivre exactement à l''identique ?',
     'What moment from this month would you live again exactly as it was?', 'month_memory', 5, 'reflective'),

    -- Juin ------------------------------------------------------------------
    ('Qu''est-ce qui t''a fait rire aux éclats récemment ?',
     'What made you laugh out loud recently?', 'lightness', 6, 'essential'),
    ('Quelle bêtise assumes-tu complètement ?',
     'What foolish thing do you own completely?', 'lightness', 6, 'reflective'),

    -- Juillet ---------------------------------------------------------------
    ('Qu''est-ce qui t''a coûté le plus d''énergie ce mois-ci ?',
     'What cost you the most energy this month?', 'introspection', 7, 'essential'),
    ('Qu''est-ce que tu comprends aujourd''hui que tu ne comprenais pas il y a cinq ans ?',
     'What do you understand today that you did not understand five years ago?', 'introspection', 7, 'reflective'),

    -- Août ------------------------------------------------------------------
    ('Avec qui as-tu passé le plus de temps ce mois-ci ?',
     'Who did you spend the most time with this month?', 'relations', 8, 'essential'),
    ('Quelle relation aimerais-tu réparer ?',
     'What relationship would you like to repair?', 'relations', 8, 'reflective'),

    -- Septembre -------------------------------------------------------------
    ('Quel conseil donnerais-tu à quelqu''un qui commence ce que tu fais ?',
     'What advice would you give someone starting out in what you do?', 'legacy', 9, 'essential'),
    ('Qu''est-ce que tu aimerais qu''on retienne de toi ?',
     'What would you like to be remembered for?', 'legacy', 9, 'reflective'),

    -- Octobre ---------------------------------------------------------------
    ('Quelle petite habitude te rend la vie meilleure ?',
     'What small habit makes your life better?', 'habits', 10, 'essential'),
    ('Qu''est-ce que tu remets toujours à demain, et pourquoi ?',
     'What do you always put off until tomorrow, and why?', 'habits', 10, 'reflective'),

    -- Novembre --------------------------------------------------------------
    ('Qui mériterait un message de ta part aujourd''hui ?',
     'Who deserves a message from you today?', 'gratitude', 11, 'essential'),
    ('Qui t''a aidé sans jamais rien demander en retour ?',
     'Who helped you without ever asking for anything in return?', 'gratitude', 11, 'reflective'),

    -- Décembre --------------------------------------------------------------
    ('Qu''est-ce que cette année t''a apporté ?',
     'What did this year bring you?', 'month_memory', 12, 'essential'),
    ('Si tu devais résumer cette année en une phrase pour tes proches, laquelle ?',
     'If you had to sum up this year in one sentence for your loved ones, what would it be?', 'month_memory', 12, 'reflective')
) AS v(text_fr, text_en, category, cycle_month, mode_target)
WHERE NOT EXISTS (
    SELECT 1 FROM checkin_questions q WHERE q.text_fr = v.text_fr
);
