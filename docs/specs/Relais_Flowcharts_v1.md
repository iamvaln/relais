RELAIS
Passe le relais, pas le chaos.
Flowcharts — Version 1.0
Avril 2026 — Confidentiel
# Introduction
Ce document présente les flowcharts du produit Relais selon deux niveaux de lecture.
| Type | Audience | Contenu |
| Flows techniques | Équipe engineering | Ce que le système fait — algorithmes, chiffrement, stockage |
| Flows fonctionnels | Product, design, stakeholders | Ce que l'utilisateur vit — écrans, décisions, émotions |

# Partie 1 — Flows Techniques
Ces flows décrivent le comportement interne du système. Ils servent de référence pour l'équipe engineering et la documentation des specs techniques.
## T1 — Création du compte
Déclencheur : l'utilisateur installe l'app et crée son compte pour la première fois.
| 🌱 | Génération du seedL'app génère 12 mots BIP39 aléatoirement |

↓
| 👁 | Affichage uniqueLes 12 mots sont affichés UNE seule fois. L'utilisateur les note physiquement. Jamais stockés nulle part. |

↓
| 🔑 | Dérivation des clés par catégorieseed + ctx 'relais_comptes_v1' → Argon2id → K1 seed + ctx 'relais_messages_v1' → Argon2id → K2 seed + ctx 'relais_finances_v1' → Argon2id → K3 |

↓
| 🗄 | Création de la base localeSQLite chiffré créé sur le device. 3 tables chiffrées vides. Rien envoyé en ligne. |

↓
| 🔐 | Mot de passe localmot de passe → Argon2id → K_login. K_login permet de recalculer K1 K2 K3 à chaque ouverture. |

↓
| ☁ | Backup initial StorjP1_1 P1_2 P1_3 → HCV Transit → P2_1 P2_2 P2_3 → Storj. Backup disponible dès la création. |

↓
| ✅ | Compte crééTransmission PAS encore activée. Base locale prête. |

## T2 — Saisie et chiffrement local
Déclencheur : l'utilisateur ajoute une donnée dans son coffre.
| ✏️ | Saisie de la donnée DD existe en clair uniquement en mémoire vive |

↓  Choix de catégorie
| ◇ Quelle catégorie ? |

| Comptes & accès | Messages personnels | Données financières |
| XChaCha20(K1, D) → P1_1 | XChaCha20(K2, D) → P1_2 | XChaCha20(K3, D) → P1_3 |

↓
| 💾 | Écriture dans SQLite localPi_1 écrit dans la table correspondante. D en clair détruit de la mémoire vive. |

↓
| ☁ | Sync Storj automatiquePi_1 → HCV Transit → Pi_2 → Storj. Déclenché à chaque modification. |

## T3 — Activation de la transmission et création des clés
Déclencheur : l'utilisateur configure ses contacts de confiance et active la transmission.
| 👥 | Configuration des contactsL'user désigne M contacts, choisit le schéma N-of-M. Pour chaque contact : 3 questions secrètes + rôle(s). Questions stockées en PostgreSQL. Réponses JAMAIS stockées. |

↓
| ✂️ | Découpe de K par catégorie — Shamir N-of-MK1 → Shamir N-of-M → S1_1, S1_2, ... S1_M K2 → Shamir N-of-M → S2_1, S2_2, ... S2_M K3 → Shamir N-of-M → S3_1, S3_2, ... S3_M |

↓
| 🔒 | Protection de chaque partPour chaque contact i et chaque catégorie j : Argon2id(réponses_i) → K_i éphémère XChaCha20(K_i, Sj_i) → Sj_i_enc K_i détruite immédiatement |

↓
| 🗄 | Stockage PostgreSQLSj_i_enc (32 bytes) stocké en PostgreSQL pour chaque contact i et catégorie j. S et K éphémères détruits. |

↓
| ✅ | Transmission activéeContacts notifiés par email de confirmation de leur rôle. |

## T4 — Dead man's switch et check-in
Déclencheur : le délai de check-in configuré par l'utilisateur est dépassé.
| ⏰ | Check-in dûDélai configuré par l'user dépassé sans activité |

↓
| 📩 | Notification gamifiée envoyéeMini-jeu ou énigme — pas une alerte morbide |

| ◇ L'user répond dans les délais ? |

| ✓ OUI — répond correctementCheck-in validé. Compteur remis à zéro. Prochain check-in planifié. |  | ✗ NON — ignoreRelance 1 envoyée 7 jours après. |

Si silence total après 3 relances :
| 🔴 | Dead man's switch déclenchéContacts notifiés. Flow de transmission post-mortem enclenché (voir T6). |

## T5 — Accès quotidien par l'owner
Déclencheur : l'utilisateur ouvre l'app normalement.
| 🔓 | Authentification localemot de passe → Argon2id → K_login → K1 K2 K3 en mémoire vive |

↓
| 📖 | Lecture depuis SQLite localLecture de P1_1 P1_2 P1_3. Aucun appel réseau. Aucun téléchargement. |

↓
| 🔓 | Déchiffrement localXChaCha20(K1, P1_1) → D1 XChaCha20(K2, P1_2) → D2 XChaCha20(K3, P1_3) → D3 D1 D2 D3 en mémoire vive uniquement |

↓
| 👁 | Affichage dans l'appD visible par l'user. Existe uniquement en mémoire vive. |

↓  Fermeture app
| 🧹 | Nettoyage mémoireK1 K2 K3 détruites. D1 D2 D3 détruits. Pi_1 restent sur disque chiffré. |

## T6 — Reconstitution des clés post-mortem
Déclencheur : le dead man's switch s'est déclenché. Les contacts reçoivent leur notification.
| 📧 | Email reçu par chaque contactMessage personnel de l'user + lien app. Pas de données sensibles dans l'email. |

↓
| ❓ | Questions secrètes dans l'appLe contact ouvre l'app via le lien. Répond aux 3 questions définies par le défunt. |

| ◇ Réponses correctes ? |

| ✓ OUIArgon2id(réponses) → K_i. XChaCha20(K_i, Sj_i_enc) → Sj_i. K_i détruite. Sj_i en escrow PostgreSQL (TTL 72h). |  | ✗ NONNouvelle tentative. Compte limité à 5 essais puis blocage. |

↓
| ◇ N parts disponibles pour catégorie j ? |

| ✓ OUI — N parts en escrowSj_1 + Sj_2 + ... → Shamir → Kj reconstituée en mémoire vive. |  | ✗ NON — attenteNotification au contact suivant. Escrow maintenu jusqu'à TTL 72h. |

## T7 — Download et déchiffrement final post-mortem
Déclencheur : Kj est reconstituée en mémoire vive sur le device du dernier contact.
| ☁ | Téléchargement depuis StorjFragments de Pi_2 téléchargés et reconstitués sur le device du recipient. |

↓
| 🔓 | Déchiffrement HCVAppel API HCV Transit : Pi_2 → Pi_1. HCV ne voit pas Kj. |

↓
| 🔓 | Déchiffrement final localXChaCha20(Kj, Pi_1) → Dj en clair. Sur device du recipient uniquement. Rien en clair sur le réseau. |

↓
| 📤 | Transmission au data recipient désignéDj affiché dans l'app du recipient. Export local possible. |

↓
| 🧹 | Nettoyage immédiatPi_2 supprimé Storj. Sj_i_enc supprimés PostgreSQL. Escrow vidé. Kj détruite. Statut 'transmis' conservé. |

## T8 — Restauration multi-device
Déclencheur : l'utilisateur change ou perd son téléphone.
| 📱 | Nouveau deviceInstallation de l'app. L'user entre ses 12 mots BIP39. |

↓
| 🔑 | Recalcul des clésseed + ctx → Argon2id → K1, K2, K3 recalculées. Déterministe — toujours les mêmes clés depuis le même seed. |

↓
| ☁ | Téléchargement backupP2_1 P2_2 P2_3 téléchargés depuis Storj. HCV Transit : Pi_2 → Pi_1. |

↓
| 💾 | Base locale reconstituéePi_1 écrits dans nouvelle SQLite. Base locale identique à l'original. |

↓
| 🔐 | Nouveau mot de passe localL'user définit un nouveau mot de passe de confort. S1_enc S2_enc intacts — transmission inchangée. |

# Partie 2 — Flows Fonctionnels
Ces flows décrivent ce que l'utilisateur vit. Ils servent de référence pour le design, le product management, et les user stories. Aucun terme technique — uniquement des actions, des écrans, et des décisions.
## F1 — Onboarding de l'owner (Adjoua)
Déclencheur : Adjoua télécharge Relais et l'ouvre pour la première fois.
Persona : Adjoua, 31 ans, Douala. Découvre Relais via une recommandation.
| 🏠 | Écran d'accueilLogo Relais. Slogan : Passe le relais, pas le chaos. |

↓
| 📖 | Onboarding — 3 slidesSlide 1 : Ton coffre numérique Slide 2 : Tes contacts de confiance Slide 3 : Un jeu mensuel pour rester actif |

↓
| 👤 | Créer mon compteAdjoua clique sur Créer mon compte. |

↓
| ⚠️ | Affichage des 12 motsÉcran solennel. Message : Note ces mots dans un endroit sûr — ils ne seront plus affichés. Adjoua les écrit sur papier. |

| ◇ J'ai bien noté mes 12 mots ? |

| ✓ OUI — je confirmePassage à l'étape suivante. |  | ✗ Pas encoreL'app attend. Pas de skip possible. |

↓
| 🔐 | Créer un mot de passeAdjoua choisit un mot de passe pour ouvrir l'app au quotidien. |

↓
| 🎉 | Coffre prêtMessage : Ton coffre est prêt. Ajoute ton premier compte. |

| ◇ Ajouter un compte maintenant ? |

| ✓ OUIChoisir la catégorie. Remplir les infos et instructions. Compte ajouté. |  | ✗ Plus tardAccès au tableau de bord. Coffre vide. |

## F2 — Configuration de la transmission
Déclencheur : Adjoua veut activer la transmission vers ses proches.
Pré-requis : au moins un compte dans le coffre.
| ⚙️ | Section TransmissionAdjoua accède aux paramètres de transmission depuis son tableau de bord. |

↓
| 🔢 | Choisir le schémaCombien de contacts ? Combien suffisent ? Ex : 2 contacts sur 3 peuvent déverrouiller. |

↓
| 👤 | Ajouter Contact 1Nom, email, numéro. Choisir son rôle : Gestionnaire / Gardien / Exécuteur. |

↓
| ❓ | Créer 3 questions secrètesQuestions dont seul ce contact connaît la réponse. Ex : Quel était le prénom de ta première institutrice ? |

↓
| 💌 | Écrire un message personnelMessage qui sera envoyé à ce contact au moment de la transmission. |

| ◇ Autre contact à ajouter ? |

| ✓ OUIRetour à l'étape Ajouter un contact. |  | ✗ NONPassage à la suite. |

↓
| 🎯 | Configurer qui reçoit quoiPar catégorie : Comptes vers Hervé. Messages vers Maman. Finances vers l'avocat. |

↓
| ⏱ | Configurer les délaisDurée du silence avant déclenchement (ex : 3 mois). Fréquence des check-ins (ex : 1 fois par mois). |

↓
| 📋 | Récapitulatif completAdjoua vérifie toute la configuration avant d'activer. |

| ◇ Tout est correct ? |

| ✓ OUI — ActiverTransmission activée. Contacts notifiés de leur rôle par email. |  | ✗ ModifierRetour à l'étape concernée. |

| ✅ | Tableau de bord mis à jourStatut : Transmission active. Badge vert sur le tableau de bord. |

## F3 — Usage quotidien et check-in mensuel
Déclencheur : Adjoua ouvre l'app — soit normalement, soit parce que son check-in du mois est dû.
| 📱 | Adjoua ouvre RelaisEntre son mot de passe. |

| ◇ Check-in du mois disponible ? |

| ✓ OUI — check-in dûNotification ludique. Énigme ou mini-jeu à résoudre. |  | ✗ NONAccès direct au tableau de bord. |

↓  Si check-in
| ◇ Bonne réponse au jeu ? |

| ✓ OUICheck-in validé. Badge mensuel. Prochain dans N jours. |  | ✗ NONRéessayer. Pas de pénalité. |

↓  Tableau de bord
| 📊 | Tableau de bordVue sur le coffre. Statut de la transmission. Dernière sync. |

| Action possible | Ce que l'user voit / fait |
| Ajouter un compte | Choisir la catégorie, remplir les infos et instructions de fermeture |
| Modifier une info | Modifier et enregistrer — sync automatique |
| Capsule temps | Répondre à la question du mois — ajoutée à la capsule privée |
| Voir ses contacts | Statut de chaque contact, modifier les questions ou le rôle |
| Fermer l'app | Session terminée — à dans un mois |

## F4 — Expérience du trusted contact (Hervé)
Déclencheur : le dead man's switch s'est déclenché. Hervé reçoit un email de Relais.
Persona : Hervé, 35 ans, Yaoundé. Probablement en deuil ou sous le choc.
| ⚠️ Principe de conception : chaque écran que voit Hervé doit être simple, humain, et guidé. Pas de jargon technique. |

| 📧 | Email reçuObjet : Adjoua vous a laissé quelque chose d'important. Contenu : message personnel qu'Adjoua a écrit pour Hervé. Bouton : Accéder à ce qu'Adjoua vous a préparé. |

↓
| 📱 | Ouverture de l'appHervé télécharge Relais ou ouvre dans le navigateur. Écran sobre, chaleureux. |

↓
| ❓ | Vérification d'identité3 questions secrètes qu'Adjoua a définies. Hervé répond. |

| ◇ Réponses correctes ? |

| ✓ OUIIdentité confirmée. Message : Merci Hervé, nous attendons la confirmation de l'autre contact. |  | ✗ NONMessage d'erreur doux. Nouvelle tentative possible. Support disponible. |

↓
| ⏳ | En attente de l'autre contactHervé est notifié dès que l'autre contact confirme. Délai maximum : 72h. |

↓
| 🔓 | Accès déverrouilléMessage : Vous pouvez maintenant accéder à ce qu'Adjoua avait préparé pour vous. |

↓
| 📋 | Checklist guidéeOrganisée par niveau d'urgence. Chaque tâche a les instructions rédigées par Adjoua. |

| Niveau | Couleur | Exemples |
| Immédiat | Rouge | Abonnements avec prélèvements actifs, comptes avec solde |
| Sous 30 jours | Orange | Réseaux sociaux, emails professionnels, comptes actifs |
| À votre discrétion | Vert | Comptes dormants, archives, données non urgentes |

| ✅ | Marquer comme faitChaque tâche cochée est archivée. Hervé voit sa progression. |

| ◇ Toutes les tâches traitées ? |

| ✓ OUIHervé confirme la transmission complète. Données supprimées de Relais. Message de clôture. |  | ✗ Pas encoreHervé peut revenir plus tard. L'app garde la progression. |

| 🙏 | Mission accomplieDonnées supprimées de Relais. Seul le log de confirmation est conservé. Message de clôture chaleureux. |

— Fin des Flowcharts v1.0 —
Prochaines étapes : User Stories, Wireframes
