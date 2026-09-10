RELAIS
Passe le relais, pas le chaos.
Frontend Specs — Patch v1.2
Patch DEC-28/29 — crypto_box_seal pour notification_enc, signature Si_enc.
Avril 2026 — Confidentiel
# Sections modifiées
| Section | Changement |
| §5.2 Crypto — chiffrement | crypto_box_seal remplace XChaCha20(relais_public_key) (DEC-28) |
| §5.5 Activation transmission | Signature Ed25519 sur chaque Si_enc ajoutée (DEC-29) |

# §5.2 — crypto_box_seal pour notification_enc [DEC-28]
| XChaCha20(relais_public_key) était incorrect — XChaCha20 est symétrique. crypto_box_seal de libsodium est le bon primitif : ECDH éphémère X25519 + XChaCha20-Poly1305. |

| // src/crypto/vault.ts — chiffrement notification contact// 1. Récupérer la clé publique Relais (mise en cache)const { relais_x25519_pk } = await api.get('/transmission/relais-key')const pkBytes = base64ToBuffer(relais_x25519_pk)// 2. Chiffrer avec crypto_box_sealconst sodium = getSodium()const plaintext = new TextEncoder().encode( JSON.stringify({ email: contactEmail, phone: contactPhone }))const notification_enc = sodium.crypto_box_seal(plaintext, pkBytes)// → libsodium génère une paire éphémère en interne// → ECDH avec relais_x25519_pk// → XChaCha20-Poly1305// → Retourne ephemeral_pk || ciphertext// 3. Signer pour intégrité (inchangé)const { sk } = await deriveEd25519(seed)const notification_sig = await ed.signAsync(notification_enc, sk)sk.fill(0) |

# §5.5 — Signature Ed25519 sur Si_enc à l'activation [DEC-29]
| Cohérent avec DEC-07 (signature vault). Un access token volé ne peut pas remplacer une part Shamir sans la clé ed25519_sk dérivée du seed. |

| // src/crypto/shamir.ts — activation transmissionasync function encryptAndSignShare( share: Buffer, responses: string[], seed: Uint8Array): Promise<{ Si_enc: Uint8Array, hash: string, signature: Uint8Array }> { // 1. Chiffrer la part avec K_i (réponses du contact) const K_i = await deriveKey( Buffer.from(responses.join('|')), 'relais_contact_v1' ) const Si_enc = encrypt(share, K_i) K_i.fill(0) // 2. Signer SHA256(Si_enc) avec ed25519_sk (DEC-29) const hash = sha256(Si_enc) // Uint8Array const hashHex = bufferToHex(hash) const { sk } = await deriveEd25519(seed) const signature = await ed.signAsync(hash, sk) sk.fill(0) return { Si_enc, hash: hashHex, signature }}// Utilisation dans le flow d'activationconst shares = shamir.split(K, { shares: M, threshold: N })for (let i = 0; i < contacts.length; i++) { const { Si_enc, hash, signature } = await encryptAndSignShare( shares[i], contacts[i].responses, seed ) // Push Si_enc sur Storj const storj_path = await storj.upload(userId, `shares/${contactId}`, Si_enc) // Inclure dans le payload POST /transmission/activate payload.contacts[i] = { ...payload.contacts[i], storj_path, share_hash: hash, share_sig: bufferToBase64(signature) // ← DEC-29 }} |

— Fin du patch Frontend Specs DEC-28/29
