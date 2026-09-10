RELAIS
Passe le relais, pas le chaos.
Journal des Décisions Architecture — Addendum v1.2
Addendum v1.2 — DEC-28 à DEC-30.
Avril 2026 — Confidentiel
# Addendum v1.2 — DEC-28 à DEC-30
| Décisions issues du formulaire de revue des specs (3 questions ouvertes). Complète l'Addendum v1.1 (DEC-20 à DEC-27). |

| Décision | Titre | Documents impactés |
| DEC-28 | notification_enc : crypto_box_seal (sealed box X25519) — pas XChaCha20 symétrique | Specs Techniques, Backend Specs, Frontend Specs |
| DEC-29 | Si_enc signés Ed25519 à l'activation (comme le vault — DEC-07) | Specs Techniques §4.3, Backend Specs §3.4 |
| DEC-30 | Email activation contacts : en direct via abstraction secrets (pas de stub) | Backend Specs §3.4, Frontend Specs |

| DEC-28 notification_enc : crypto_box_seal X25519 — correction de la formulationImpact : Specs Techniques §1,§4.3 — Backend Specs §3.1 — Frontend Specs §5 |

| ERREUR dans toutes les specs précédentes : XChaCha20(relais_public_key, ...) est incorrect. XChaCha20 est un chiffrement symétrique — il ne peut pas chiffrer vers une clé publique. La primitive correcte est crypto_box_seal de libsodium (ECDH éphémère X25519 + XChaCha20-Poly1305). |

Correction de formulation
| // AVANT (incorrect dans toutes les specs)notification_enc = XChaCha20(relais_public_key, { email, phone })// APRÈS (DEC-28)notification_enc = crypto_box_seal({ email, phone }, relais_x25519_pk)// crypto_box_seal (libsodium) fait internement :// 1. Génère une paire éphémère (ek_pk, ek_sk)// 2. ECDH : shared_secret = X25519(ek_sk, relais_x25519_pk)// 3. Dérive une clé symétrique depuis shared_secret// 4. Chiffre avec XChaCha20-Poly1305// 5. Retourne ek_pk || ciphertext// → Le client ne connaît jamais la clé privée de Relais ✅// Déchiffrement côté serveurplaintext = crypto_box_seal_open( notification_enc, relais_x25519_pk, // clé publique relais_x25519_sk // clé privée — depuis HCV Secrets Engine) |

Endpoint ajouté — Backend Specs §3.1
| // Nouveau endpoint pour exposer la clé publique de RelaisGET /transmission/relais-key → Pas d'authentification requise → Returns: { relais_x25519_pk: base64 } → Mis en cache côté client (la clé change rarement) → Rotatable sans impact sur les clients qui mettent en cache (il suffit d'invalider le cache et de re-fetcher) |

Impact HCV
| // relais_x25519_sk = clé privée X25519 de Relais// Stockée dans HCV Secrets Engine (DEC-15)// C'est la même clé que 'relais_private_key' — juste correctement typée// HCV Secrets Engine — clés stockéesrelais/x25519_sk → clé privée X25519 pour crypto_box_seal_open → notifie les contacts en déchiffrant notification_enc |

| DEC-29 Si_enc signés Ed25519 à l'activation — cohérent avec DEC-07Impact : Specs Techniques §4.3 — Backend Specs §3.4 |

| DEC-07 signe les syncs vault pour garantir qu'un access token volé ne peut pas remplacer le vault. Même argument pour les parts Shamir : un access token volé ne doit pas pouvoir remplacer Si_enc d'un contact par une part hostile qui ferait échouer la transmission. |

| // Côté client — activation transmissionfor each contact_i: S_i = shamir.split(K)[i] // part Shamir brute K_i = Argon2id(réponses_contact_i) Si_enc = XChaCha20(K_i, S_i) // chiffré avec réponses hash_i = SHA256(Si_enc) sig_i = Ed25519.sign(hash_i, ed25519_sk) // ← DEC-29 // push Si_enc sur Storj // envoyer { storj_path, share_hash: hash_i, signature: sig_i } au serveur// Côté serveur — POST /transmission/activatefor each contact_payload: valid = Ed25519.verify(sig_i, hash_i, ed25519_pk) // depuis users table if not valid → rejeter toute l'activation ❌ // Si valide → enregistrer storj_path + share_hash + hash on-chain Arbitrum |

Garantie apportée
| Menace | Sans DEC-29 | Avec DEC-29 |
| Access token volé avant activation | Attaquant remplace Si_enc → transmission échoue silencieusement | Impossible — signature invalide sans ed25519_sk |
| Serveur Relais compromis | Si_enc remplacés en base | Hash on-chain Arbitrum détecte la modification |
| Si_enc corrompus sur Storj | Déchiffrement échoue mais sans preuve | SHA256(Si_enc) vérifiable on-chain à tout moment |

| DEC-30 Email activation contacts : en direct via abstraction secretsImpact : Backend Specs §3.4 — src/services/secrets.ts |

| La gestion de la clé est déjà tranchée (DEC-15 : relais_x25519_sk dans HCV). Un stub repousserait une décision déjà prise et laisserait un trou dans le flow critique E3-US06. |

Abstraction secrets
| // src/services/secrets.ts// Abstraction fine : env var en dev/test, HCV en prod// Le reste du code ne connaît pas HCV directementasync function getRelaisX25519Sk(): Promise<Buffer> { if (process.env.NODE_ENV === 'production') { return await hcv.getSecret('relais/x25519_sk') } // Dev / test : clé en variable d'env locale return Buffer.from(process.env.RELAIS_X25519_SK_DEV!, 'hex')}export const secrets = { getRelaisX25519Sk } |

Flow E3-US06 complet
| // POST /transmission/activate1. Vérifier step-up token 'activate_transmission'2. Vérifier signatures Ed25519 des Si_enc (DEC-29)3. Si valides → push Si_enc sur Storj + hashes on-chain Arbitrum4. Pour chaque contact : sk = await secrets.getRelaisX25519Sk() { email, phone } = crypto_box_seal_open(notification_enc, pk, sk) // DEC-28 resend_id = await resend.send({ to: email, template: 'transmission_activated' }) INSERT email_log { email_type: 'transmission_contact', provider_id: resend_id }5. UPDATE transmission_configs SET status = 'active', activated_at = NOW()6. Enregistrer checkin on-chain Arbitrum (contrat register())7. Returns { activated: true, contacts_notified: N } |

Portée de l'abstraction
- HCV peut être branché, remplacé ou migré sans toucher les handlers
- Les tests unitaires utilisent la branche env var — pas besoin de mock HCV
- La même abstraction couvre toute clé sensible future si besoin
# Résumé des corrections à appliquer dans les specs
| Document | Section | Correction |
| Specs Techniques | §1 Vocabulaire | notification_enc : remplacer XChaCha20(relais_public_key) par crypto_box_seal(..., relais_x25519_pk) |
| Specs Techniques | §4.3 Création des clés | Idem — formulation corrigée + signature Si_enc ajoutée |
| Backend Specs | §3.1 Auth | Ajouter GET /transmission/relais-key |
| Backend Specs | §3.4 Transmission | POST /transmission/activate : signature par contact (DEC-29) + email direct (DEC-30) |
| Frontend Specs | §5.2 Crypto | crypto_box_seal pour notification_enc (DEC-28) |
| Frontend Specs | §4.3 Transmission | Ajout signature Ed25519 sur Si_enc à l'activation (DEC-29) |

— Fin de l'Addendum v1.2 — DEC-28 à DEC-30
