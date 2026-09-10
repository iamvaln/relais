RELAIS
Passe le relais, pas le chaos.
Schéma PostgreSQL — Version 1.3
v1.3 — Corrections Fix-10 à Fix-12d + Note-01.
Avril 2026 — Confidentiel
# Changelog v1.3
| Ce document est un patch sur v1.2. Il ne reprend que les tables et sections modifiées. Toutes les autres tables de v1.2 restent inchangées. |

| Ref | Table | Changement |
| Fix-10 | app_config (migration) | Retrait de la ligne UPDATE incorrecte sur dms.durations_available. Correction de la note ('2ème élément' pas '3ème'). |
| Fix-11 | checkin_questions | Catégorie 'other' ajoutée au CHECK. Colonne risk_notes TEXT ajoutée. |
| Fix-12a | checkin_questions | UNIQUE (text_fr) et UNIQUE (text_en) — empêche deux questions au libellé identique. |
| Fix-12b | payment_events | CHECK : amount_fcfa NOT NULL pour event_type IN ('created','renewed'). Évite des NULL silencieux dans le MRR. |
| Fix-12c | checkin_relances | Retire email_provider_id et delivery_status. Ajoute email_log_id FK vers email_log(id) — source de vérité unique pour la délivrance. |
| Fix-12d | app_config | Suppression de security.pin_lockout_min (remplacé par DEC-26 / pin_backoff_steps). |
| Note-01 | API | Contrainte usage_type + min_score non exprimable en SQL — à valider dans le handler POST/PUT /transmission/contacts. |

# 2. app_config — patch Fix-10 et Fix-12d
| app_configFix-10 : retrait ligne UPDATE incorrecte. Fix-12d : suppression security.pin_lockout_min.v1.2 : Fix-10 + Fix-12d |

| Fix-10 : La ligne 'UPDATE app_config SET value = 3 WHERE key = dms.durations_available' dans le changelog v1.2 était incorrecte. DEC-22 porte sur la colonne transmission_configs.silence_duration_months (DEFAULT 3), pas sur cette clé de configuration. dms.durations_available reste [1,3,6]. La valeur 3 est le 2ème élément de [1,3,6], pas le 3ème. |

| Fix-12d : security.pin_lockout_min est retiré de app_config. Il est rendu obsolète par DEC-26 (backoff progressif via security.pin_backoff_steps). Conserver les deux crée une ambiguïté pour les admins qui l'éditent sans effet. |

| -- Fix-10 : NE PAS exécuter cette ligne (incorrecte en v1.2)-- ✗ UPDATE app_config SET value = '3'-- WHERE key = 'dms.durations_available';-- dms.durations_available reste [1,3,6] — AUCUNE modification requise-- DEC-22 s'applique uniquement à transmission_configs.silence_duration_months DEFAULT 3-- Fix-12d : retirer security.pin_lockout_minDELETE FROM app_config WHERE key = 'security.pin_lockout_min';-- Remplacé par security.pin_backoff_steps = '[30,120,600,1800]'-- déjà présent depuis le patch v1.2-- État final des clés security.* après v1.3 :-- security.pin_max_attempts 5-- security.pin_backoff_steps [30,120,600,1800] ← DEC-26-- security.pwd_max_attempts 5-- security.session_months 3-- security.otp_validity_min 10-- security.otp_max_regen_hr 5-- security.contact_max_fail 5-- security.contact_lock_hrs 24-- ✗ security.pin_lockout_min supprimé |

# 3. checkin_questions — patch Fix-11 et Fix-12a
| checkin_questionsFix-11 : 'other' dans CHECK category + risk_notes. Fix-12a : UNIQUE sur text_fr et text_en.v1.2 : Fix-11 + Fix-12a |

| Fix-12a est le plus important : sans UNIQUE sur text_fr/text_en, un admin peut créer deux questions au libellé identique avec des UUID différents. Un owner les rattache toutes deux au même contact, la contrainte chk_distinct_questions passe (UUID différents), mais le contact a en réalité deux fois la même question. |

| -- Migrations à appliquer sur la table existante-- Fix-11a : ajout catégorie 'other'ALTER TABLE checkin_questions DROP CONSTRAINT IF EXISTS checkin_questions_category_check;ALTER TABLE checkin_questions ADD CONSTRAINT checkin_questions_category_check CHECK (category IN ( -- Questions secrètes (contacts) 'childhood', 'places', 'events', 'people', 'habits', 'shared_memory', -- mémoires partagées uniques (score 10 potentiel) 'other', -- Fix-11 : fourre-tout pour questions hors catégorie -- Questions carnet de vie 'month_memory', 'relations', 'work', 'gratitude', 'introspection', 'legacy', 'lightness' ));-- Fix-11b : colonne risk_notesALTER TABLE checkin_questions ADD COLUMN IF NOT EXISTS risk_notes TEXT;COMMENT ON COLUMN checkin_questions.risk_notes IS 'Notes internes sur les risques identifiés (usage back office uniquement). Ex: Réponse peut changer au fil du temps. Ne jamais afficher aux users.';-- Fix-12a : UNIQUE sur les libellés (empêche doublons)CREATE UNIQUE INDEX IF NOT EXISTS idx_cq_text_fr ON checkin_questions(text_fr) WHERE status != 'archived';CREATE UNIQUE INDEX IF NOT EXISTS idx_cq_text_en ON checkin_questions(text_en) WHERE status != 'archived';-- Index partiel : les questions archivées peuvent avoir le même libellé-- (remplacement d'une question par une reformulation améliorée) |

| shared_memory est plus précis que other pour les questions de mémoire partagée unique (surnom privé, rituel, objet symbolique). Proposer les deux catégories laisse à l'admin la granularité qu'il juge utile. |

# 13. checkin_relances — patch Fix-12c
| checkin_relancesFix-12c : suppression colonnes de délivrance redondantes. Ajout email_log_id FK.v1.2 : Fix-12c — source de vérité unique pour la délivrance |

| Avant Fix-12c : checkin_relances portait email_provider_id + delivery_status ET email_log portait les mêmes colonnes. Un webhook Resend devait mettre à jour les deux. Oublier l'un affiche 'sent' quand l'autre dit 'bounced'. Après : checkin_relances pointe vers email_log(id). Une seule mise à jour suffit. |

| -- DDL v1.3 complet de checkin_relancesCREATE TABLE checkin_relances ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, transmission_id UUID NOT NULL REFERENCES transmission_configs(id) ON DELETE CASCADE, relance_number INT NOT NULL CHECK (relance_number BETWEEN 1 AND 3), sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Fix-12c : FK vers email_log — source de vérité unique pour la délivrance -- Retrait de email_provider_id et delivery_status (étaient redondants) email_log_id UUID REFERENCES email_log(id) ON DELETE SET NULL -- SET NULL si le log est purgé (rétention 90j));CREATE INDEX idx_cr_user ON checkin_relances(user_id);CREATE INDEX idx_cr_transmission ON checkin_relances(transmission_id);CREATE INDEX idx_cr_email_log ON checkin_relances(email_log_id) WHERE email_log_id IS NOT NULL;-- Migration si la table existait déjà :-- ALTER TABLE checkin_relances ADD COLUMN email_log_id UUID-- REFERENCES email_log(id) ON DELETE SET NULL;-- ALTER TABLE checkin_relances DROP COLUMN IF EXISTS email_provider_id;-- ALTER TABLE checkin_relances DROP COLUMN IF EXISTS delivery_status; |

Flow d'envoi après Fix-12c
| // Backend — envoi d'une relanceasync function sendRelance(userId, transmissionId, relanceNumber) { // 1. Envoyer via Resend const resendId = await resend.send({ ... }) // 2. Logger dans email_log (source de vérité) const emailLogEntry = await db.email_log.create({ user_id: userId, recipient_hash: SHA256(email), email_type: `checkin_relance_${relanceNumber}`, provider_id: resendId, status: 'sent' }) // 3. Lier dans checkin_relances await db.checkin_relances.create({ user_id: userId, transmission_id: transmissionId, relance_number: relanceNumber, email_log_id: emailLogEntry.id // ← FK vers email_log })}// Webhook Resend — une seule mise à jourasync function handleResendWebhook(event) { await db.email_log.update({ where: { provider_id: event.message_id }, data: { status: event.type, updated_at: NOW() } }) // checkin_relances se lit via la FK — pas de mise à jour supplémentaire} |

# 22. payment_events — patch Fix-12b
| payment_eventsFix-12b : CHECK amount_fcfa NOT NULL pour created et renewed.v1.2 : Fix-12b — évite les NULL silencieux dans le MRR |

| Sans cette contrainte, un event 'renewed' sans montant est accepté et disparaît silencieusement du MRR (SUM ignore les NULL). Le MRR affiché dans BO-07 serait sous-estimé sans alerte. |

| -- DDL v1.3 complet de payment_eventsCREATE TABLE payment_events ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), subscription_id UUID NOT NULL REFERENCES subscriptions(id), event_type TEXT NOT NULL CHECK (event_type IN ( 'created', 'renewed', 'expired', 'cancelled', 'grace_started', 'admin_extended', 'admin_downgraded' )), amount_fcfa INT CHECK (amount_fcfa > 0), currency TEXT NOT NULL DEFAULT 'XAF', provider_ref TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Fix-12b : amount_fcfa obligatoire pour les événements générant du revenu CONSTRAINT chk_amount_required CHECK ( event_type NOT IN ('created', 'renewed') OR amount_fcfa IS NOT NULL ));CREATE INDEX idx_pe_user ON payment_events(user_id);CREATE INDEX idx_pe_type ON payment_events(event_type, created_at);-- Migration si la table existait déjà :-- ALTER TABLE payment_events ADD CONSTRAINT chk_amount_required-- CHECK (event_type NOT IN ('created','renewed') OR amount_fcfa IS NOT NULL); |

# Note-01 — Contrainte usage_type + min_score : validation API
| Non exprimable proprement en SQL standard (pas de CHECK sur sous-select). À valider dans le handler métier. Un trigger BEFORE INSERT OR UPDATE est une alternative acceptable si l'équipe préfère la ceinture et les bretelles. |

| // Handler POST /transmission/contacts et PUT /transmission/contacts/:id// Valider les 3 question_id avant insertionasync function validateContactQuestions(q1id, q2id, q3id) { const questions = await db.checkin_questions.findMany({ where: { id: { in: [q1id, q2id, q3id] }, } }) if (questions.length !== 3) { throw new ValidationError('QUESTIONS_NOT_FOUND') } const minScore = await getConfig('vault.question_min_score') // défaut : 6 for (const q of questions) { // usage_type doit être 'secret_question' ou 'both' if (q.usage_type === 'journal') { throw new ValidationError('QUESTION_WRONG_TYPE', q.id) } // score minimum if (q.reliability_score < minScore) { throw new ValidationError('QUESTION_SCORE_TOO_LOW', q.id) } // statut actif if (q.status !== 'active') { throw new ValidationError('QUESTION_NOT_ACTIVE', q.id) } }}// Alternative : trigger PostgreSQL-- CREATE OR REPLACE FUNCTION validate_contact_questions()-- RETURNS TRIGGER AS $$ ... $$ LANGUAGE plpgsql;-- À implémenter si validation 100% base souhaitée. |

— Fin du Schéma PostgreSQL v1.3 — 22 tables. Fix-10 à Fix-12d appliqués. Note-01 documentée.
