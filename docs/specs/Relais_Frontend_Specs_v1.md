RELAIS
Passe le relais, pas le chaos.
Frontend Specs — Version 1.1
v1.1 — React Native, crypto locale, flows UX. DEC-01 à DEC-31 intégrés.
Avril 2026 — Confidentiel
# Changelog
| Version | Changements |
| v1.0 | Architecture React Native, KeyStore, PIN Gate, SQLCipher |
| v1.1 | DEC-01 : seed_enc_pin permanent. DEC-03/04 : flows inactivité et nouveau device. DEC-28 : crypto_box_seal. DEC-29 : signature Si_enc. DEC-26 : backoff PIN. DEC-31 : signature carnet. |

# 1. Stack technique
| Composant | Technologie |
| Framework | React Native + Expo bare workflow |
| Langage | TypeScript |
| État global | Zustand |
| Requêtes API | TanStack Query |
| Navigation | Expo Router |
| Crypto | libsodium-wrappers (XChaCha20, Argon2id, Ed25519, crypto_box_seal) |
| Shamir | secrets.js ou implémentation custom |
| Base locale | expo-sqlite + SQLCipher (chiffrement SQLite) |
| Stockage sécurisé | expo-secure-store (seed_enc_pin) |
| Push notifications | expo-notifications |

# 2. Architecture cryptographique locale
## 2.1 KeyStore — état des clés
| seed_enc_pin est PERMANENT dans expo-secure-store. Ne jamais le supprimer — même après inactivité prolongée (DEC-01). |

| État | KeyStore | seed_enc_pin |
| App active, session valide | K1 K2 K3 en mémoire | Présent |
| Arrière-plan > 10min | K1 K2 K3 détruites | Présent |
| PIN saisi | K1 K2 K3 recalculées depuis seed | Présent |
| Inactivité > 3 mois | K1 K2 K3 détruites | Présent — jamais supprimé |
| Nouveau device / réinstallation | Vides | Absent → créé après 12 mots |

## 2.2 seed_enc_pin — stockage permanent (DEC-01)
| // À l'inscription ou premier login sur ce device const pin_key      = await Argon2id(pin, pin_salt, ctx='relais_pin_enc_v1') const seed_enc_pin = XChaCha20(pin_key, seed) await SecureStore.set('seed_enc_pin', seed_enc_pin)  // PERMANENT  // Au déverrouillage PIN const pin_key = await Argon2id(pin_saisi, pin_salt) const seed    = XChaCha20_decrypt(pin_key, seed_enc_pin) K1 = Argon2id(seed, 'relais_comptes_v1') K2 = Argon2id(seed, 'relais_messages_v1') K3 = Argon2id(seed, 'relais_finances_v1') seed.fill(0) |

## 2.3 Dérivation Ed25519
| // Déterministe — même seed = même keypair import * as ed from '@noble/ed25519'  async function deriveEd25519(seed: Uint8Array) { const sk = seed.slice(0, 32) const pk = await ed.getPublicKeyAsync(sk) return { sk, pk } } // ed25519_pk → envoyée serveur à l'inscription // ed25519_sk → dérivée à la demande, JAMAIS stockée |

# 3. Flows d'authentification
## 3.1 Inscription
| 1. Saisir email + mot de passe 2. POST /auth/register 3. App génère 12 mots BIP39 4. Affichage UNE SEULE FOIS — copier/coller désactivé 5. Checkbox obligatoire : 'J'ai noté mes 12 mots physiquement' 6. seed = BIP39.toBytes(12_mots) 7. K1, K2, K3 = Argon2id(seed, ctx_i) 8. ed25519_pk = await deriveEd25519(seed).pk 9. PUT /auth/register/keys { ed25519_pk } 10. Créer PIN → seed_enc_pin PERMANENT dans SecureStore |

## 3.2 Login quotidien
| 1. POST /auth/login → tokens 2. App vérifie seed_enc_pin présent 3. Demander biométrie ou PIN 4. PIN → seed_enc_pin → K1, K2, K3 en mémoire 5. Afficher le vault |

## 3.3 Inactivité > 3 mois (DEC-03)
| // seed_enc_pin toujours présent — tokens expirés 1. POST /auth/login → nouveaux tokens 2. App détecte : seed_enc_pin PRÉSENT 3. Demander PIN → déchiffre seed_enc_pin → K1 K2 K3 ✅ // Pas besoin des 12 mots |

## 3.4 Nouveau device — flow corrigé (DEC-04)
| // seed_enc_pin ABSENT (nouveau device / réinstallation) 1. POST /auth/login → tokens 2. App détecte : seed_enc_pin ABSENT 3. 'Créez votre PIN pour ce téléphone' 4. 'Entrez vos 12 mots pour restaurer votre coffre'  // Challenge-response (DEC-06) — seed ne transite jamais const { challenge } = await GET /auth/restore/challenge const { sk }        = await deriveEd25519(seed_saisi) const signature     = await ed.signAsync(challenge, sk) sk.fill(0) await POST /auth/restore/verify { signature }  // OK ou KO  // Si valide seed_enc_pin = XChaCha20(Argon2id(PIN), seed_saisi) SecureStore.set('seed_enc_pin', ...) // PERMANENT ✅ // Télécharger P2 depuis Storj → déchiffrer → SQLite local |

## 3.5 PIN Gate — blocage progressif (DEC-26)
| // 100% côté client — PIN ne transite jamais sur le réseau const BACKOFF_STEPS = [30, 120, 600, 1800]  // secondes // Depuis app_config: security.pin_backoff_steps  if (failCount >= 5) { const stepIndex = Math.min(failCount - 5, BACKOFF_STEPS.length - 1) const lockDuration = BACKOFF_STEPS[stepIndex] showLockTimer(lockDuration) } |

# 4. Vault — sync et accès
## 4.1 Lecture locale
| // Aucun appel réseau pour consulter le vault const encrypted = await sqlite.get('SELECT * FROM accounts WHERE id = ?', [id]) const D = XChaCha20_decrypt(K1, encrypted.payload) // D affiché en mémoire vive — détruit à la fermeture |

## 4.2 Sync vers Storj (DEC-07)
| async function syncVault(category: 'accounts'|'messages'|'finances') { const rows = await sqlite.getAll(`SELECT * FROM ${category}`) const P1   = JSON.stringify(rows) const Ki   = KeyStore.getKey(category) const P2   = XChaCha20(Ki, P1)  // Signature Ed25519 const seed = XChaCha20_decrypt(Argon2id(PIN), seed_enc_pin) const { sk } = await deriveEd25519(seed) const sig  = await ed.signAsync(sha256(P2), sk) sk.fill(0) ; seed.fill(0)  await api.post('/vault/sync', { category, payload:   bufferToBase64(P2), signature: bufferToBase64(sig) }) } |

# 5. Configuration transmission
## 5.1 notification_enc (DEC-28 — crypto_box_seal)
| // Récupérer clé publique Relais const { relais_x25519_pk } = await api.get('/transmission/relais-key') const pk = base64ToUint8Array(relais_x25519_pk)  // Chiffrer email + téléphone const plaintext      = new TextEncoder().encode(JSON.stringify({ email, phone })) const notification_enc = sodium.crypto_box_seal(plaintext, pk)  // Signer const { sk } = await deriveEd25519(seed) const notification_sig = await ed.signAsync(notification_enc, sk) sk.fill(0) |

## 5.2 Si_enc + signatures (DEC-29)
| async function encryptAndSignShare(share: Uint8Array, responses: string[], seed: Uint8Array) { // Chiffrer la part const K_i    = await Argon2id(responses.join('|'), 'relais_contact_v1') const Si_enc = XChaCha20(K_i, share) K_i.fill(0)  // Signer SHA256(Si_enc) const hash = sha256(Si_enc) const { sk } = await deriveEd25519(seed) const sig = await ed.signAsync(hash, sk) sk.fill(0)  return { Si_enc, hash: bufferToHex(hash), sig: bufferToBase64(sig) } } |

## 5.3 secret_enc (DEC-20)
| // v1.1 : secret_enc sans les questions const secret_enc = XChaCha20(K2, JSON.stringify({ nom: contactName, role: selectedRole, message_personnel: personalMessage // ✗ questions retirées — dans question_1/2/3_id })) |

## 5.4 Questions (DEC-20)
| // L'owner choisit 3 questions dans la bibliothèque // GET /transmission/checkin-questions (filtre : usage_type != 'journal') // question_1_id, question_2_id, question_3_id = UUID stockés en clair |

# 6. Carnet de vie — écritures signées (DEC-31)
| // POST /journal/entries const content_enc = XChaCha20(K2, JSON.stringify({ question_id, entry_month, mode, texte })) const sig = await signPayload(content_enc, seed) await api.post('/journal/entries', { content_enc: bufferToBase64(content_enc), signature:   bufferToBase64(sig), entry_month, mode, word_count_approx })  // DELETE /journal/entries/:id const sig = await signPayload(uuidToBytes(id), seed) await api.delete(`/journal/entries/${id}`, { body: { signature: bufferToBase64(sig) } })  // Wrapped const stats_enc = XChaCha20(K2, JSON.stringify(statsCalculéesLocalement)) const sig       = await signPayload(stats_enc, seed) await api.post(`/journal/wrapped/${year}`, { stats_enc: bufferToBase64(stats_enc), signature: bufferToBase64(sig) })  async function signPayload(payload: Uint8Array, seed: Uint8Array) { const { sk } = await deriveEd25519(seed) const sig    = await ed.signAsync(sha256(payload), sk) sk.fill(0) return sig } |

# 7. Sécurité locale
| Risque | Protection |
| Jailbreak / root — lecture mémoire | K1/K2/K3 détruites dès l'arrière-plan. seed.fill(0) après chaque usage. |
| Vol du device déverrouillé | Biométrie / PIN requis toutes les 10min d'inactivité. |
| Analyse du stockage local | SQLite chiffré SQLCipher. expo-secure-store pour seed_enc_pin. |
| Replay d'une requête sync | Signature Ed25519 unique par payload — replay invalide la vérification. |
| Remplacement Si_enc par attaquant | Signature Ed25519 sur chaque part (DEC-29) — vérifiée par le serveur. |

## Avertissements onboarding obligatoires
Écran 12 mots — non-passable, checkbox obligatoire, copier/coller désactivé
Responsabilité contacts — check 'Je comprends que Relais ne peut pas contourner les questions'
Tableau Relais PEUT / ne PEUT PAS faire — affiché à l'activation
— Fin des Frontend Specs v1.1
