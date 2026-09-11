RELAIS
Passe le relais, pas le chaos.
Backend Specs — Version 1.1
v1.1 — API REST, BullMQ, intégrations. Toutes corrections intégrées.
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

| # Variables d'environnement hébergeur (pas dans HCV) DATABASE_URL=postgresql://... REDIS_URL=redis://... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... JWT_CHECKIN_SECRET=... JWT_STEPUP_SECRET=... STORJ_ENDPOINT=... STORJ_ACCESS_KEY=... STORJ_SECRET_KEY=... STORJ_BUCKET=... RESEND_API_KEY=... ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc RELAIS_CONTRACT_ADDRESS=0x...  # HashiCorp Vault (clé privée uniquement) HCV_ADDR=https://vault.example.com HCV_TOKEN=hvs.XXXXX  # Dev/test seulement RELAIS_X25519_SK_DEV=hex_de_la_clé |

# 2. Authentification
## 2.1 Endpoints auth
| POST   /auth/register              → Créer un compte POST   /auth/login                 → Se connecter POST   /auth/logout                → Se déconnecter POST   /auth/refresh               → Renouveler l'access token POST   /auth/email/verify          → Valider OTP email POST   /auth/email/resend-otp      → Renvoyer OTP email POST   /auth/password/reset-request POST   /auth/password/reset PUT    /auth/password              → Changer mot de passe (step-up) POST   /auth/2fa/setup             → QR code TOTP POST   /auth/2fa/verify            → Valider TOTP DELETE /auth/2fa                   → Désactiver 2FA (step-up) POST   /auth/pin/step-up           → Step-up token (DEC-25) GET    /auth/restore/challenge     → Challenge Ed25519 (DEC-06, TTL 5min) POST   /auth/restore/verify        → Vérifier signature Ed25519 POST   /auth/seed/display          → Autoriser affichage 12 mots (DEC-27, step-up 'view_seed') |

## 2.2 JWT et sessions
| // access_token : TTL 15 minutes, HttpOnly cookie // refresh_token : TTL 90 jours, HttpOnly cookie — hash stocké en sessions // step_up_token : TTL 5 minutes, usage unique, jti blacklisté Redis |

## 2.3 Step-up token — canonique (DEC-25)
| POST /auth/pin/step-up Body: { action: StepUpAction } Auth: Bearer <access_token> Returns: { step_up_token, action, exp }  X-Step-Up-Token: <token>  // header sur endpoints protégés  type StepUpAction = | 'edit_transmission' | 'activate_transmission' | 'delete_transmission' | 'edit_contacts' | 'change_password' | 'view_seed' | 'disable_2fa'   | 'admin_action' |

# 3. Vault
| DEC-21 : vault purement local. PostgreSQL ne stocke aucune métadonnée de vault. Pas de /vault/accounts ni /vault/summary. free_max_accounts = 5 appliqué côté client uniquement. |

| POST /vault/sync Body: { category: 'accounts'|'messages'|'finances', payload: base64(P2), signature: base64(Ed25519.sign(SHA256(P1), sk)) } 1. Ed25519.verify(signature, SHA256(P2 equivalent), ed25519_pk) 2. Stocke P2 sur Storj à storj_vault_path Returns: { synced_at, storj_path }  POST /vault/restore Body: { category } → Télécharge P2 depuis Storj → retourne à l'app → L'app déchiffre P2 avec Ki  GET  /vault/sync-status Returns: { accounts: { synced_at }, messages: {...}, finances: {...} } |

# 4. Transmission
## 4.1 GET /transmission/relais-key (DEC-28)
| GET /transmission/relais-key → Pas d'authentification → Cache-Control: public, max-age=86400 Returns: { relais_x25519_pk: base64, key_version: string } |

## 4.2 Contacts
| Note-01 : validateContactQuestions() vérifie usage_type ≠ 'journal', reliability_score ≥ min_score, status = 'active' avant insertion. |

| GET    /transmission/contacts       → Liste contacts POST   /transmission/contacts       → Ajouter contact PUT    /transmission/contacts/:id   → Modifier (step-up 'edit_contacts') DELETE /transmission/contacts/:id   → Supprimer (step-up 'edit_contacts') |

## 4.3 Activation (DEC-28/29/30)
| POST /transmission/activate  (step-up 'activate_transmission') Body: { silence_duration_months, checkin_frequency_weeks, schema_n, schema_m, contacts: [{ contact_id, notification_enc, notification_sig,  // DEC-28 secret_enc, question_1_id, question_2_id, question_3_id, has_k1_role, has_k2_role, has_k3_role, storj_k1_path, storj_k2_path, storj_k3_path, share_k1_hash, share_k2_hash, share_k3_hash, share_k1_sig, share_k2_sig, share_k3_sig,  // DEC-29 verify_token }] }  Serveur : 1. Vérifier step-up 'activate_transmission' 2. Vérifier Ed25519.verify(notification_sig, notification_enc, ed25519_pk)  // DEC-29 3. Vérifier Ed25519.verify(share_kj_sig, share_kj_hash, ed25519_pk) par catégorie 4. Persister en PostgreSQL 5. Pusher hashes on-chain Arbitrum (contract.register()) 6. DEC-30 : pour chaque contact : sk = await secrets.getRelaisX25519Sk() {email} = crypto_box_seal_open(notification_enc, pk, sk) await resend.send({ to: email, ... }) INSERT email_log { email_type: 'contact_designated' } 7. UPDATE transmission_configs status='active' Returns: { activated: true, contacts_notified: N } |

## 4.4 Vérification annuelle
| POST /transmission/verify-contact/:id Body: { verify_token_enc }  // l'owner re-saisit les réponses localement Returns: { verified: true } ou { verified: false } |

# 5. Check-in (DEC-33/34/35)
| GET  /checkin/game → Sélectionne énigme checkin_questions → game_token JWT { question_id, answer_hash, exp: 10min } — Redis TTL 10min Returns: { question_fr, question_en, game_type, game_token }  POST /checkin/game/answer { game_token, answer } 1. Vérifie token (non expiré, non utilisé) 2. Compare SHA256(answer) avec answer_hash 3. Invalide token Redis (usage unique) 4. Si correct → checkin_token { valid: true, exp: 15min }  POST /checkin/complete { checkin_token, journal_entry_id? } 1. Vérifie checkin_token 2. INSERT checkin_log (streak calculé, badge éventuel) 3. UPDATE transmission_configs last_checkin_at, next_checkin_due, relance_count=0 4. [si contrat branché] Arbitrum checkin() |

# 6. Journal et Wrapped (DEC-31/32)
| POST /journal/entries Body: { content_enc, signature, entry_month, mode, word_count_approx } Serveur: Ed25519.verify(signature, SHA256(content_enc), ed25519_pk)  PUT  /journal/entries/:id  -- même vérification signature DELETE /journal/entries/:id { signature }  -- signature sur SHA256(uuid_bytes)  GET  /journal/entries GET  /journal/entries/:id GET  /journal/entries/month/:ym  POST /journal/wrapped/:year Serveur: entry_count = COUNT(*) WHERE user_id AND year if entry_count < 6 → 409 WRAPPED_INSUFFICIENT_ENTRIES Body: { stats_enc, signature } Serveur: vérifie signature, INSERT annual_wrappeds {entry_count recalculé}  GET  /journal/wrapped/:year POST /journal/wrapped/:year/export  → UPDATE exported_at = NOW() |

# 7. Relay (post-mortem)
| GET  /relay/:token Returns: { questions: [{id, text_fr, text_en}],  // DEC-20 : texte public roles: {k1, k2, k3}, schema: {n, m}, contacts_answered: int }  POST /relay/:token/verify Body: { share_enc: base64(Si_tmp_enc) } → L'app a déjà déchiffré Si_enc avec K_i côté client → Envoie Si re-chiffré clé session Redis → INSERT escrow_shares (TTL 72h) Returns: { accepted: true, shares_remaining: int }  GET  /relay/:token/status POST /relay/:token/confirm  → déclenche nettoyage Storj |

# 8. Dead man's switch — Jobs BullMQ (DEC-35)
| // JOB quotidien : deadman:checkin for each transmission WHERE status='active' AND pause_mode=false: overdue_since     = NOW() - last_checkin_at silence_threshold = silence_duration_months × 30 jours days_overdue      = (NOW() - next_checkin_due).days  // Relances J+7, J+14, J+21 if relance_count=0 AND days_overdue>=7:  enqueue deadman:relance (1) if relance_count=1 AND days_overdue>=14: enqueue deadman:relance (2) if relance_count=2 AND days_overdue>=21: enqueue deadman:relance (3)  // DEC-35 : déclenchement quand 3 relances ET silence_duration_months écoulé if relance_count=3 AND overdue_since >= silence_threshold: enqueue deadman:trigger  // JOB deadman:trigger 1. UPDATE transmission_configs status='triggered' 2. INSERT transmissions { escrow_expires_at = NOW() + 72h } 3. Pour chaque contact : sk = secrets.getRelaisX25519Sk() {email} = crypto_box_seal_open(notification_enc, pk, sk) resend.send({ to: email, relay_url }) INSERT email_log { email_type: 'transmission_contact' } 4. [si contrat branché] Arbitrum isTriggered() vérifié |

# 9. Intégrations
## 9.1 Abstraction secrets (DEC-30)
| // src/services/secrets.ts export const secrets = { async getRelaisX25519Sk(): Promise<Buffer> { if (process.env.NODE_ENV === 'production') { return hcv.getSecret('relais/x25519_sk') } return Buffer.from(process.env.RELAIS_X25519_SK_DEV!, 'hex') } } |

## 9.2 Ed25519 — vérification
| // src/services/crypto/ed25519.ts async function verifySignature(payload: Buffer, sig: Buffer, pk: Buffer) { const hash = SHA256(payload) return Ed25519.verify(sig, hash, pk) } |

## 9.3 Storj
| // S3-compatible — endpoint Storj DCS await storj.putObject({ Bucket, Key: path, Body: P2 }) await storj.getObject({ Bucket, Key: path }) → P2 await storj.deleteObject({ Bucket, Key: path }) |

## 9.4 Resend + email_log
| const { id } = await resend.emails.send({ from: 'noreply@getrelais.app', to: email, subject, html }) await db.email_log.create({ recipient_hash: SHA256(email), email_type, provider_id: id, status: 'sent' }) // Webhook Resend → UPDATE email_log SET status WHERE provider_id = event.id |

— Fin des Backend Specs v1.1
