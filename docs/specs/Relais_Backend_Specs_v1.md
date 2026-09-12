RELAIS
Passe le relais, pas le chaos.
Backend Specs — Version 1.2
v1.2 — Corrections B.1-B.7, D.1-D.5 appliquées.
Avril 2026 — Confidentiel
# Changelog
| Version | Changements |
| v1.0 | API REST, BullMQ, HCV, Resend, Storj |
| v1.1 | DEC-21 : vault purement local (/vault/accounts supprimés). DEC-25 : step-up canonique. DEC-27 : POST /auth/seed/display. DEC-28 : GET /transmission/relais-key. DEC-29 : signatures Si_enc. DEC-30 : abstraction secrets. |

# 1. Stack et configuration
| Composant | Technologie |
| Runtime | Node.js 22 LTS |
| Framework | Fastify + TypeScript |
| ORM | Prisma |
| Queue | BullMQ + Redis |
| Email | Resend |
| Stockage | Storj (S3-compatible) |
| Blockchain | Arbitrum L2 via ethers.js |
| Secrets | HashiCorp Vault (relais_x25519_sk uniquement) |

| # Variables d'environnement hébergeur (pas dans HCV)DATABASE_URL=postgresql://...REDIS_URL=redis://...JWT_ACCESS_SECRET=...JWT_REFRESH_SECRET=...JWT_CHECKIN_SECRET=...JWT_STEPUP_SECRET=...STORJ_ENDPOINT=...STORJ_ACCESS_KEY=...STORJ_SECRET_KEY=...STORJ_BUCKET=...RESEND_API_KEY=...ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpcRELAIS_CONTRACT_ADDRESS=0x...# HashiCorp Vault (clé privée uniquement)HCV_ADDR=https://vault.example.comHCV_TOKEN=hvs.XXXXX# Dev/test seulementRELAIS_X25519_SK_DEV=hex_de_la_clé |

# 2. Authentification
## 2.1 Endpoints auth
| POST /auth/register → Créer un comptePOST /auth/login → Se connecterPOST /auth/logout → Se déconnecterPOST /auth/refresh → Renouveler l'access tokenPOST /auth/email/verify → Valider OTP emailPOST /auth/email/resend-otp → Renvoyer OTP emailPOST /auth/password/reset-requestPOST /auth/password/resetPUT /auth/password → Changer mot de passe (step-up)POST /auth/2fa/setup → QR code TOTPPOST /auth/2fa/verify → Valider TOTPDELETE /auth/2fa → Désactiver 2FA (step-up)POST /auth/pin/step-up → Step-up token (DEC-25)GET /auth/restore/challenge → Challenge Ed25519 (DEC-06, TTL 5min)POST /auth/restore/verify → Vérifier signature Ed25519POST /auth/seed/display → Autoriser affichage 12 mots (DEC-27, step-up 'view_seed') |

## 2.2 JWT et sessions
| // access_token : TTL 15 minutes, HttpOnly cookie// refresh_token : TTL 90 jours, HttpOnly cookie — hash stocké en sessions// step_up_token : TTL 5 minutes, usage unique, jti blacklisté Redis |

## 2.3 Step-up token — canonique (DEC-25)
| POST /auth/pin/step-up Body: { action: StepUpAction } Auth: Bearer <access_token> Returns: { step_up_token, action, exp }X-Step-Up-Token: <token> // header sur endpoints protégéstype StepUpAction = | 'edit_transmission' | 'activate_transmission' | 'delete_transmission' | 'edit_contacts' | 'change_password' | 'view_seed' | 'disable_2fa' | 'admin_action' |

# 3. Vault
| DEC-21 : vault purement local. PostgreSQL ne stocke aucune métadonnée de vault. Pas de /vault/accounts ni /vault/summary. free_max_accounts = 5 appliqué côté client uniquement. |

| POST /vault/sync Body: { category: 'accounts'|'messages'|'finances', payload: base64(P2), signature: base64(Ed25519.sign(SHA256(P1), sk)) } 1. Ed25519.verify(signature, SHA256(P2 equivalent), ed25519_pk) 2. Stocke P2 sur Storj à storj_vault_path Returns: { synced_at, storj_path }POST /vault/restore Body: { category } → Télécharge P2 depuis Storj → retourne à l'app → L'app déchiffre P2 avec KiGET /vault/sync-status Returns: { accounts: { synced_at }, messages: {...}, finances: {...} } |

# 4. Transmission
## 4.1 GET /transmission/relais-key (DEC-28)
| GET /transmission/relais-key → Pas d'authentification → Cache-Control: public, max-age=86400 Returns: { relais_x25519_pk: base64, key_version: string } |

## 4.2 Contacts
| Note-01 : validateContactQuestions() vérifie usage_type ≠ 'journal', reliability_score ≥ min_score, status = 'active' avant insertion. |

| GET /transmission/contacts → Liste contactsPOST /transmission/contacts → Ajouter contactPUT /transmission/contacts/:id → Modifier (step-up 'edit_contacts')DELETE /transmission/contacts/:id → Supprimer (step-up 'edit_contacts') |

## 4.3 Activation (DEC-28/29/30)
| POST /transmission/activate (step-up 'activate_transmission')Body: { silence_duration_months, checkin_frequency_weeks, schema_n, schema_m, contacts: [{ contact_id, notification_enc, notification_sig, // DEC-28 secret_enc, question_1_id, question_2_id, question_3_id, has_k1_role, has_k2_role, has_k3_role, storj_k1_path, storj_k2_path, storj_k3_path, share_k1_hash, share_k2_hash, share_k3_hash, share_k1_sig, share_k2_sig, share_k3_sig, // DEC-29 verify_token }]}Serveur :1. Vérifier step-up 'activate_transmission'2. Vérifier Ed25519.verify(notification_sig, notification_enc, ed25519_pk) // DEC-293. Vérifier Ed25519.verify(share_kj_sig, share_kj_hash, ed25519_pk) par catégorie4. Persister en PostgreSQL5. Pusher hashes on-chain Arbitrum (contract.register())6. DEC-30 : pour chaque contact : sk = await secrets.getRelaisX25519Sk() {email} = crypto_box_seal_open(notification_enc, pk, sk) await resend.send({ to: email, ... }) INSERT email_log { email_type: 'contact_designated' }7. UPDATE transmission_configs status='active'Returns: { activated: true, contacts_notified: N } |

## 4.4 Vérification annuelle
| POST /transmission/verify-contact/:id Body: { verify_token_enc } // l'owner re-saisit les réponses localement Returns: { verified: true } ou { verified: false } |

# 5. Check-in (DEC-33/34/35)
| GET /checkin/game → Sélectionne énigme checkin_questions → game_token JWT { question_id, answer_hash, exp: 10min } — Redis TTL 10min Returns: { question_fr, question_en, game_type, game_token }POST /checkin/game/answer { game_token, answer } 1. Vérifie token (non expiré, non utilisé) 2. Compare SHA256(answer) avec answer_hash 3. Invalide token Redis (usage unique) 4. Si correct → checkin_token { valid: true, exp: 15min }POST /checkin/complete { checkin_token, journal_entry_id? } 1. Vérifie checkin_token 2. INSERT checkin_log (streak calculé, badge éventuel) 3. UPDATE transmission_configs last_checkin_at, next_checkin_due, relance_count=0 4. [si contrat branché] Arbitrum checkin() |

# 6. Journal et Wrapped (DEC-31/32)
| POST /journal/entries Body: { content_enc, signature, entry_month, mode, word_count_approx } Serveur: Ed25519.verify(signature, SHA256(content_enc), ed25519_pk)PUT /journal/entries/:id -- même vérification signatureDELETE /journal/entries/:id { signature } -- signature sur SHA256(uuid_bytes)GET /journal/entriesGET /journal/entries/:idGET /journal/entries/month/:ymPOST /journal/wrapped/:year Serveur: entry_count = COUNT(*) WHERE user_id AND year if entry_count < 6 → 409 WRAPPED_INSUFFICIENT_ENTRIES Body: { stats_enc, signature } Serveur: vérifie signature, INSERT annual_wrappeds {entry_count recalculé}GET /journal/wrapped/:yearPOST /journal/wrapped/:year/export → UPDATE exported_at = NOW() |

# 7. Relay (post-mortem)
| GET /relay/:token Returns: { questions: [{id, text_fr, text_en}], // DEC-20 : texte public roles: {k1, k2, k3}, schema: {n, m}, contacts_answered: int }POST /relay/:token/verify Body: { share_enc: base64(Si_tmp_enc) } → L'app a déjà déchiffré Si_enc avec K_i côté client → Envoie Si re-chiffré clé session Redis → INSERT escrow_shares (TTL 72h) Returns: { accepted: true, shares_remaining: int }GET /relay/:token/statusPOST /relay/:token/confirm → déclenche nettoyage Storj |

# 8. Dead man's switch — Jobs BullMQ (DEC-35)
| // JOB quotidien : deadman:checkinfor each transmission WHERE status='active' AND pause_mode=false: overdue_since = NOW() - last_checkin_at silence_threshold = silence_duration_months × 30 jours days_overdue = (NOW() - next_checkin_due).days // Relances J+7, J+14, J+21 if relance_count=0 AND days_overdue>=7: enqueue deadman:relance (1) if relance_count=1 AND days_overdue>=14: enqueue deadman:relance (2) if relance_count=2 AND days_overdue>=21: enqueue deadman:relance (3) // DEC-35 : déclenchement quand 3 relances ET silence_duration_months écoulé if relance_count=3 AND overdue_since >= silence_threshold: enqueue deadman:trigger// JOB deadman:trigger1. UPDATE transmission_configs status='triggered'2. INSERT transmissions { escrow_expires_at = NOW() + 72h }3. Pour chaque contact : sk = secrets.getRelaisX25519Sk() {email} = crypto_box_seal_open(notification_enc, pk, sk) resend.send({ to: email, relay_url }) INSERT email_log { email_type: 'transmission_contact' }4. [si contrat branché] Arbitrum isTriggered() vérifié |

# 9. Intégrations
## 9.1 Abstraction secrets (DEC-30)
| // src/services/secrets.tsexport const secrets = { async getRelaisX25519Sk(): Promise<Buffer> { if (process.env.NODE_ENV === 'production') { return hcv.getSecret('relais/x25519_sk') } return Buffer.from(process.env.RELAIS_X25519_SK_DEV!, 'hex') }} |

## 9.2 Ed25519 — vérification
| // src/services/crypto/ed25519.tsasync function verifySignature(payload: Buffer, sig: Buffer, pk: Buffer) { const hash = SHA256(payload) return Ed25519.verify(sig, hash, pk)} |

## 9.3 Storj
| // S3-compatible — endpoint Storj DCSawait storj.putObject({ Bucket, Key: path, Body: P2 })await storj.getObject({ Bucket, Key: path }) → P2await storj.deleteObject({ Bucket, Key: path }) |

## 9.4 Resend + email_log
| const { id } = await resend.emails.send({ from: 'noreply@getrelais.app', to: email, subject, html})await db.email_log.create({ recipient_hash: SHA256(email), email_type, provider_id: id, status: 'sent'})// Webhook Resend → UPDATE email_log SET status WHERE provider_id = event.id |

# Corrections v1.2
| Ref | Changement |
| B.1 | POST /transmission/activate : client envoie octets Si (pas chemins). Serveur choisit path, calcule hash. |
| B.2 | POST /transmission/contacts/:id/verify { signature } — vérification locale app, attestation signée. |
| B.3 | DEC-33 : bibliothèque intégrée serveur, jeton opaque, réponse jamais transmise au client. |
| B.4 | POST /relay/:token/verify : { shares:{k1?,k2?,k3?} } ou { failed:true }. |
| B.6 | RELAIS_X25519_SK_DEV interdit en prod. HCV KV v2 obligatoire. /health sonde sys/health. |
| B.7 | POST /auth/keys (pas PUT /auth/register/keys). Une seule fois après OTP. |
| D.1 | POST /auth/2fa/verify retourne 8 codes à l'activation. recovery_code accepté au login. |
| D.2 | notification_enc inclut owner_display_name (60 chars max). |
| D.3 | plain_hash + plain_sig à l'activation. RELAY_SHARE_INVALID (422) si hash ≠. |
| D.4 | contact_progress email. relay:cleanup plafonné à dms.relay_max_restarts (3). transmission_stalled. |
| D.5 | GET /admin/logs/api supprimé. Alerte erreur API → outil externe (Loki/Datadog). |
| Audit | Signature vault : SHA256(category+ts+P2). ts dans body. Rejet si ts > 5min. |

## §2.1 POST /auth/keys (B.7) + codes récupération (D.1)
| -- B.7 : endpoint correctPOST /auth/keys { ed25519_pk: base64 } -- une seule fois après OTP-- D.1 : codes de récupération 2FAPOST /auth/2fa/verify À l'ACTIVATION : Returns: { verified: true, recovery_codes: string[8] } Au LOGIN : Body: { temp_token, totp_code } OU { temp_token, recovery_code } |

## §3 Signature vault avec ts (audit sécurité)
| POST /vault/sync Body: { category, ts, payload: base64(P2), signature: base64(Ed25519.sign(SHA256(cat+ts+P2), sk)) } Serveur : vérifie sig + rejette si |NOW()-ts| > 5min |

## §4.3 Activation (B.1, D.2, D.3)
| -- B.1 : client envoie octets (pas chemins Storj)shares.kN: { enc: base64(Si_enc), sig, plain_sig }-- Serveur : choisit storj_path, calcule SHA256(Si_enc), vérifie sig sur ce hash-- D.2 : notification_enc = crypto_box_seal({email,phone,owner_display_name?}, pk)-- D.3 : après vérification plain_sigshare_kN_plain_hash stocké dans trusted_contacts (pour comparaison relay) |

## §4.4 verify-contact (B.2)
| -- Ancien (incorrect) : POST /transmission/verify-contact/:id { verify_token_enc }-- Correct (B.2) :POST /transmission/contacts/:id/verify Body: { signature: Ed25519.sign(SHA256(verify_token), owner_sk) } → UPDATE verify_last_checked_at = NOW() |

## §5 Check-in DEC-33 corrigé (B.3)
| -- checkin_questions : pas d'answer_hash dans le schéma-- Bibliothèque intégrée serveur : api/checkin/games.ts-- game_token opaque (réponse en Redis, jamais transmise au client)GET /checkin/game → { question_fr, question_en, game_type, game_token }POST /checkin/game/answer { game_token, answer_index } → checkin_token si correct |

## §7 Relay (B.4, D.3)
| POST /relay/:token/verify Body: { shares: { k1?: base64(S1_brut), k2?, k3? } } -- B.4 OU : { failed: true } D.3 : Compare SHA256(S_kN_reçu) avec share_kN_plain_hash Si ≠ → 422 RELAY_SHARE_INVALID, fail_count++ |

## §8 DMS relay:cleanup (D.4)
| const maxRestarts = getConfig('dms.relay_max_restarts') // défaut 3const expiredCount = COUNT(transmissions WHERE status='expired' AND config_id=$1)if expiredCount >= maxRestarts: alerte transmission_stalled → dashboard return // ne pas relancer |

## §9.1 Secrets (B.6)
| // HCV KV v2 OBLIGATOIRE en prod — pas de repliif isProd: return hcv.kvGet(HCV_SECRET_PATH, HCV_SECRET_FIELD)// RELAIS_X25519_SK_DEV interdit en prod// /health sonde {HCV_ADDR}/v1/sys/health |

— Fin des Backend Specs v1.2
