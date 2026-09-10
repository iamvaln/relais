RELAIS
Passe le relais, pas le chaos.
Backend Specs — Patch v1.2
Patch DEC-28/29/30 — relais-key endpoint, activate avec signatures, email direct.
Avril 2026 — Confidentiel
# Sections modifiées
| Section | Changement |
| §3.1 Auth / Transmission | GET /transmission/relais-key ajouté (DEC-28) |
| §3.4 Transmission | POST /transmission/activate : signatures Si_enc (DEC-29) + email direct (DEC-30) |
| §5 Intégrations | src/services/secrets.ts documenté (DEC-30) |

# §3.1 — Nouveau endpoint [DEC-28]
| // Endpoint public — expose la clé publique X25519 de RelaisGET /transmission/relais-key → Pas d'authentification requise → Rate limit souple : 60 req/min par IP → Cache-Control: public, max-age=86400 (clé change rarement) Returns: { relais_x25519_pk: string, // base64 key_version: string // pour invalidation de cache côté client } |

# §3.4 — POST /transmission/activate [DEC-28/29/30]
| DEC-29 : chaque Si_enc est accompagné d'une signature Ed25519. DEC-30 : l'email aux contacts est envoyé directement dans ce handler via l'abstraction secrets. |

| POST /transmission/activate Auth: Bearer <access_token> Header: X-Step-Up-Token: <token action='activate_transmission'> Body: { silence_duration_months: int, checkin_frequency_weeks: int, schema_n: int, schema_m: int, contacts: [{ contact_id: uuid, notification_enc: base64, // crypto_box_seal (DEC-28) notification_sig: base64, // Ed25519.sign(notification_enc, sk) secret_enc: base64, question_1_id: uuid, question_2_id: uuid, question_3_id: uuid, has_k1_role: bool, has_k2_role: bool, has_k3_role: bool, storj_k1_path: string | null, storj_k2_path: string | null, storj_k3_path: string | null, share_k1_hash: string | null, // SHA256 hex share_k2_hash: string | null, share_k3_hash: string | null, share_k1_sig: base64 | null, // Ed25519.sign(SHA256(Si_enc), sk) DEC-29 share_k2_sig: base64 | null, share_k3_sig: base64 | null, verify_token: base64 }] } // Traitement serveur 1. Vérifier step-up token 'activate_transmission' 2. Pour chaque contact : vérifier signature Ed25519 sur notification_enc Ed25519.verify(notification_sig, notification_enc, ed25519_pk) // DEC-29 3. Pour chaque part non-null : vérifier signature sur share hash Ed25519.verify(share_kj_sig, share_kj_hash, ed25519_pk) // DEC-29 4. Si toutes les signatures valides → persister en PostgreSQL 5. Pusher hashes on-chain Arbitrum (contract.register()) 6. DEC-30 : pour chaque contact, déchiffrer + notifier sk = await secrets.getRelaisX25519Sk() { email } = crypto_box_seal_open(notification_enc, pk, sk) resend_id = await resend.send({ to: email, ... }) INSERT email_log 7. UPDATE transmission_configs status='active' Returns: { activated: true, contacts_notified: N } |

# §5 — Abstraction secrets [DEC-30]
| Tous les accès à des clés sensibles passent par src/services/secrets.ts. HCV est branché uniquement en production. En dev/test : variable d'env locale. Le reste du code ne connaît pas HCV directement. |

| // src/services/secrets.tsimport { hcv } from './hcv-client'export const secrets = { // Clé privée X25519 pour crypto_box_seal_open (DEC-28) async getRelaisX25519Sk(): Promise<Buffer> { if (process.env.NODE_ENV === 'production') { return hcv.getSecret('relais/x25519_sk') } return Buffer.from(process.env.RELAIS_X25519_SK_DEV!, 'hex') }, // Extension future : autres clés sensibles ici // async getArbitrumSigningKey(): Promise<Buffer> { ... }}// Usage dans les handlersimport { secrets } from '../services/secrets'const sk = await secrets.getRelaisX25519Sk()const { email } = crypto_box_seal_open(notification_enc, relais_pk, sk) |

— Fin du patch Backend Specs DEC-28/29/30
