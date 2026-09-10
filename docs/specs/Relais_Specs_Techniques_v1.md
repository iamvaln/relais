RELAIS
Passe le relais, pas le chaos.
Specs Techniques — Patch v1.3
Patch DEC-28/29/30 — crypto_box_seal, signature Si_enc, email direct.
Avril 2026 — Confidentiel
# Sections modifiées
| Section | Changement |
| §1 Vocabulaire | notification_enc : crypto_box_seal X25519 (pas XChaCha20 symétrique) |
| §4.3 Création des clés | notification_enc corrigé + signature Ed25519 sur Si_enc (DEC-29) |
| §5 Stockage | Tableau mis à jour : notification_enc = crypto_box_seal |

# §1 — Vocabulaire : notification_enc [DEC-28]
| CORRECTION : XChaCha20(relais_public_key) était une erreur. XChaCha20 est symétrique. La primitive correcte est crypto_box_seal (ECDH éphémère X25519 + XChaCha20-Poly1305). |

| Terme | Définition corrigée v1.3 |
| notification_enc | {email, phone} du contact chiffré avec crypto_box_seal(plaintext, relais_x25519_pk). Seul Relais peut déchiffrer avec relais_x25519_sk (HCV). Le client obtient relais_x25519_pk via GET /transmission/relais-key. |
| relais_x25519_pk | Clé publique X25519 de Relais. Exposée publiquement via GET /transmission/relais-key. Utilisée par le client pour crypto_box_seal. |
| relais_x25519_sk | Clé privée X25519 de Relais. Stockée dans HCV Secrets Engine (DEC-15). Utilisée côté serveur pour crypto_box_seal_open lors des notifications. |

# §4.3 — Création des clés : configuration contacts [DEC-28 + DEC-29]
| // CONFIGURATION D'UN TRUSTED CONTACT (activation transmission)// NIVEAU 1 — notification_enc (DEC-28 : crypto_box_seal)relais_x25519_pk = await GET /transmission/relais-keynotification_enc = crypto_box_seal( JSON.encode({ email, phone }), relais_x25519_pk // clé publique X25519 de Relais)notification_sig = Ed25519.sign(notification_enc, owner_sk)// NIVEAU 2 — secret_enc (inchangé)secret_enc = XChaCha20(K2_owner, { nom, rôle, message_personnel })// QUESTIONS — références bibliothèque (DEC-20, inchangé)question_1_id, question_2_id, question_3_id// PARTS SHAMIR — DEC-29 : signature Ed25519 sur chaque Si_encfor each contact_i: S_i = shamir.split(K_j)[i] K_i = Argon2id(réponses_contact_i, ctx='relais_contact_v1') Si_enc = XChaCha20(K_i, S_i) hash_i = SHA256(Si_enc) sig_i = Ed25519.sign(hash_i, ed25519_sk) // ← DEC-29 ed25519_sk.fill(0) // push Si_enc sur StorjPOST /transmission/activate { contacts: [{ contact_id, notification_enc, // crypto_box_seal (DEC-28) notification_sig, // Ed25519.sign(notification_enc, owner_sk) secret_enc, question_1_id, question_2_id, question_3_id, has_k1_role, has_k2_role, has_k3_role, storj_k1_path, storj_k2_path, storj_k3_path, share_k1_hash, share_k2_hash, share_k3_hash, share_k1_sig, share_k2_sig, share_k3_sig, // ← DEC-29 verify_token }]} |

# §5 — Tableau de stockage mis à jour [DEC-28]
| Donnée | Chiffrement | Où | Qui peut lire |
| notification_enc | crypto_box_seal(relais_x25519_pk) | PostgreSQL | Relais (crypto_box_seal_open avec relais_x25519_sk depuis HCV) |
| notification_sig | Ed25519.sign(notification_enc, owner_sk) | PostgreSQL | Vérifiable par tous |
| secret_enc | XChaCha20(K2_owner) | PostgreSQL | Owner uniquement |
| Si_enc | XChaCha20(K_i) | Storj | Contact i (réponses) |
| Hash(Si_enc) + sig | Ed25519.sign(SHA256(Si_enc), owner_sk) | Arbitrum + PostgreSQL | Vérifiable par tous |
| relais_x25519_pk | — | Endpoint public GET /transmission/relais-key | Tous (public) |
| relais_x25519_sk | HCV Secrets Engine | HCV | Relais backend uniquement |

— Fin du patch Specs Techniques DEC-28/29/30
