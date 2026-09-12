RELAIS
Passe le relais, pas le chaos.
User Stories — Version 1.1
v1.1 — 35 stories, 6 épiques. Erratas E1-US03, E3-US04, E3-US05 appliqués.
Avril 2026 — Confidentiel
# Erratas v1.1
| 3 corrections appliquées dans cette version. Les stories corrigées sont signalées par un bandeau ⚠️ Errata. |

| Story | Errata | Correction |
| E1-US03 | Blocage PIN : '30 secondes' (fixe) | Backoff progressif [30s, 2min, 10min, 30min]. DEC-26. |
| E3-US04 | 'data recipient externe (email uniquement)' | Supprimé — le destinataire est toujours un trusted contact avec rôle. DEC-23. |
| E3-US05 | 'Bimestriel' comme fréquence de check-in | Corrigé en 'Bimensuel (toutes les 2 semaines)'. |

# Conventions
| Champ | Description |
| ID | Code unique — Ex: E1-US01. E = Épique, US = User Story. |
| Priorité | P0 Critique / P1 Haute / P2 Moyenne / P3 Basse |
| Persona | Qui ? Adjoua (owner), Hervé (trusted contact), Rodrigue (early adopter) |
| Story | En tant que [persona], je veux [action] afin de [bénéfice] |
| Critères d'acceptation | Conditions vérifiables pour considérer la story comme complète |
| Note | Contrainte technique, UX ou de sécurité à ne pas oublier |

| Épique | Code | Stories |
| Création de compte et onboarding | E1 | 6 |
| Gestion du coffre | E2 | 7 |
| Configuration de la transmission | E3 | 7 |
| Check-in mensuel et dead man's switch | E4 | 5 |
| Expérience du trusted contact | E5 | 5 |
| Sécurité et paramètres du compte | E6 | 5 |

| E1 — Création de compte et onboardingTout ce qui concerne la première expérience utilisateur, de l'installation jusqu'au premier compte enregistré dans le coffre. |

| E1-US01 | P0 — Critique | Persona : Adjoua |
| En tant que nouvel utilisateur, je veux créer un compte avec mon email et mon mot de passe afin d'avoir accès à mon coffre personnel sécurisé. |
| Critères d'acceptation✓ L'user saisit : prénom, nom, email, numéro de téléphone, mot de passe✓ Un OTP à 6 chiffres est envoyé à l'email pour vérification✓ Le compte n'est créé qu'après validation de l'OTP✓ L'OTP expire après 10 minutes✓ Le mot de passe doit faire minimum 10 caractères avec au moins 1 majuscule, 1 chiffre, 1 caractère spécial✓ En cas d'email déjà utilisé, un message clair est affiché sans révéler si le compte existeNote techniqueL'email est l'identifiant principal. Le numéro de téléphone est collecté dès V1 pour le 2FA SMS en V2 — pas encore vérifié. |

| E1-US02 | P0 — Critique | Persona : Adjoua |
| En tant que nouvel utilisateur, je veux voir et noter mes 12 mots de récupération à la création du compte afin de pouvoir restaurer mon accès si je perds mon téléphone. |
| Critères d'acceptation✓ Les 12 mots BIP39 sont affichés UNE seule fois après la création du compte✓ L'écran indique clairement : 'Ces mots ne seront plus jamais affichés. Notez-les maintenant.'✓ L'user doit cocher 'J'ai bien noté mes 12 mots' avant de continuer✓ Aucun bouton 'Passer' ou 'Plus tard' sur cet écran✓ Copier/coller est désactivé pour éviter la sauvegarde en clair dans le presse-papier✓ Les 12 mots ne sont jamais envoyés ni stockés sur le serveurNote techniqueÉcran critique pour la sécurité. Le ton doit être solennel mais pas anxiogène. Éviter le jargon technique. |

| E1-US03 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux configurer la biométrie et un PIN de secours afin de pouvoir ouvrir l'app rapidement sans ressaisir mon mot de passe à chaque fois. |
| Critères d'acceptation✓ Après la création du compte, l'app propose d'activer la biométrie (Face ID ou empreinte selon le device)✓ Si la biométrie est activée, l'user définit aussi un PIN à 6 chiffres comme fallback✓ Si la biométrie est refusée, le PIN seul est configuré✓ Le PIN ne peut pas être 000000, 123456, ou toute séquence trop simple✓ Biométrie et PIN ne fonctionnent que pendant la session active (3 mois d'inactivité max)✓ Après 5 tentatives PIN incorrectes : blocage progressif — 30s, puis 2min, puis 10min, puis 30minNote techniqueImplémenté 100% côté client. security.pin_backoff_steps = [30,120,600,1800].⚠️ ErrataDEC-26 : '30 secondes' remplacé par backoff progressif [30s, 2min, 10min, 30min]. |

| E1-US04 | P1 — Haute | Persona : Adjoua |
| En tant que nouvel utilisateur, je veux voir un onboarding de 3 slides avant de créer mon compte afin de comprendre ce que fait Relais avant de m'engager. |
| Critères d'acceptation✓ 3 slides : Ton coffre numérique / Tes contacts de confiance / Un jeu mensuel pour rester actif✓ Chaque slide a une illustration, un titre, et une description courte✓ Navigation par swipe ou par bouton Suivant✓ Bouton Passer disponible dès le premier slide✓ Bouton Commencer sur le dernier slide mène à la création de compte |

| E1-US05 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux me connecter avec mon email et mot de passe afin d'accéder à mon coffre depuis n'importe quel device. |
| Critères d'acceptation✓ L'user saisit email + mot de passe✓ Après authentification réussie : biométrie ou PIN disponibles pour les sessions suivantes✓ Après 3 mois d'inactivité : mot de passe complet obligatoire, biométrie et PIN réinitialisés✓ Sur un nouveau device non reconnu : 2FA TOTP si activé, sinon mot de passe seul✓ Après 5 tentatives échouées : compte verrouillé 15 minutes✓ Option 'Mot de passe oublié' disponible — réinitialisation via email + 12 mots BIP39Note techniqueSi l'user a perdu à la fois son mot de passe ET ses 12 mots, aucune récupération n'est possible. Ce message doit être clair dans la politique de sécurité. |

| E1-US06 | P2 — Moyenne | Persona : Adjoua |
| En tant que nouvel utilisateur, je veux ajouter mon premier compte dans le coffre guidé par un tutoriel afin de comprendre comment organiser mes informations. |
| Critères d'acceptation✓ Après la configuration du PIN/biométrie, l'app propose d'ajouter un premier compte✓ Tutoriel en 3 étapes : choisir la catégorie / remplir les infos / ajouter les instructions✓ Un exemple pré-rempli fictif est affiché pour guider l'user✓ Option 'Plus tard' disponible — mène au tableau de bord vide✓ Le tutoriel n'est affiché qu'une seule fois |

| E2 — Gestion du coffreTout ce qui concerne l'ajout, la modification, la consultation et l'organisation des comptes et informations dans le coffre. |

| E2-US01 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux ajouter un compte dans mon coffre avec ses informations et instructions de fermeture afin que mes proches sachent exactement quoi faire. |
| Critères d'acceptation✓ L'user choisit une catégorie : Comptes & accès / Messages personnels / Données financières✓ Champs : Nom du service, Login, Mot de passe, Instructions de fermeture (texte libre), Niveau d'urgence, Notes✓ Tous les champs sauf Nom du service sont optionnels✓ Les données sont chiffrées localement avant toute écriture sur le disque✓ Confirmation visuelle après enregistrement✓ La sync Storj est déclenchée automatiquement en arrière-planNote techniqueLe champ Instructions est le plus important du produit. Placeholder : 'Appelle le 8008, demande la résiliation au nom de Valentine, ils demandent la CNI.' |

| E2-US02 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux consulter mes comptes enregistrés afin de vérifier que mes informations sont à jour. |
| Critères d'acceptation✓ La liste des comptes est accessible depuis le tableau de bord✓ Filtrage par catégorie et par niveau d'urgence✓ Recherche par nom de service✓ Le mot de passe est masqué par défaut — icône œil pour révéler✓ Aucun appel réseau pour la consultation — lecture depuis SQLite local uniquement✓ Les données sont déchiffrées en mémoire vive et détruites à la fermeture de l'app |

| E2-US03 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux modifier un compte existant afin de garder mes informations à jour quand quelque chose change. |
| Critères d'acceptation✓ L'user peut modifier tous les champs d'un compte existant✓ Les modifications sont chiffrées et écrites localement immédiatement✓ La sync Storj est déclenchée automatiquement après modification✓ Un historique de la dernière modification est affiché (date uniquement, pas le contenu)✓ Un PIN est requis pour modifier les informations d'un compte financier |

| E2-US04 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux supprimer un compte de mon coffre afin de garder uniquement les informations pertinentes. |
| Critères d'acceptation✓ L'user peut supprimer un compte depuis sa fiche✓ Une confirmation est demandée avant suppression✓ La suppression est immédiate et définitive — pas de corbeille✓ La sync Storj est mise à jour après suppression✓ Si le compte supprimé était le dernier d'une catégorie, un message encourage à en rajouter |

| E2-US05 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux écrire un message personnel pour chacun de mes trusted contacts afin de leur laisser quelque chose d'humain au-delà des données techniques. |
| Critères d'acceptation✓ Un message personnel peut être rédigé pour chaque contact dans la section Transmission✓ Texte libre, longueur illimitée✓ Le message est chiffré avec la Ki correspondante au rôle du contact✓ L'user peut modifier le message à tout moment✓ Un aperçu anonymisé confirme que le message est bien enregistré |

| E2-US06 | P2 — Moyenne | Persona : Adjoua |
| En tant qu'utilisateur, je veux voir un tableau de bord résumant l'état de mon coffre afin de savoir si tout est en ordre d'un seul coup d'œil. |
| Critères d'acceptation✓ Le tableau de bord affiche : nombre de comptes par catégorie, statut de la transmission, date du prochain check-in, dernière sync Storj✓ Un badge d'alerte si la transmission n'est pas encore activée✓ Un badge de succès si le dernier check-in a été validé✓ Accès rapide aux catégories depuis le tableau de bord |

| E2-US07 | P2 — Moyenne | Persona : Adjoua |
| En tant qu'utilisateur, je veux alimenter ma capsule temps chaque mois afin de laisser à mes proches une trace de ma vie au-delà de mes mots de passe. |
| Critères d'acceptation✓ Chaque mois, une question est proposée lors du check-in : ex. 'Quel est ton meilleur souvenir de ce mois ?'✓ La réponse est ajoutée à la capsule temps privée de l'user✓ La capsule est chiffrée avec K2 (catégorie messages personnels)✓ La capsule est incluse dans la transmission au Gardien du souvenir✓ L'user peut relire ses réponses passées dans la section Capsule temps |

| E3 — Configuration de la transmissionTout ce qui concerne la désignation des trusted contacts, la définition des rôles, des questions secrètes, et l'activation de la transmission. |

| E3-US01 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux désigner au minimum 2 trusted contacts et choisir le schéma N-of-M afin que mes données ne soient accessibles que si plusieurs personnes collaborent. |
| Critères d'acceptation✓ L'user peut ajouter entre 2 et 5 trusted contacts✓ Pour chaque contact : nom, email, numéro de téléphone✓ L'user choisit le schéma : combien de contacts sur le total sont nécessaires pour déverrouiller✓ Le minimum est toujours 2-of-2 — impossible d'activer avec moins✓ Un résumé du schéma choisi est affiché clairement avant confirmationNote techniqueLe schéma N-of-M est une décision de sécurité importante. L'UX doit l'expliquer simplement : 'Il faudra que 2 de vos 3 contacts répondent pour accéder à vos informations.' |

| E3-US02 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux définir le rôle de chaque trusted contact afin que chacun reçoive uniquement les informations qui le concernent. |
| Critères d'acceptation✓ 3 rôles disponibles : Gestionnaire pratique (comptes & accès) / Gardien du souvenir (messages personnels & capsule) / Exécuteur financier (données financières)✓ Un contact peut avoir plusieurs rôles✓ Au moins un contact doit être Gestionnaire pratique✓ L'user voit clairement ce que chaque contact pourra voir selon son rôle✓ Les rôles peuvent être modifiés à tout moment avant et après l'activation |

| E3-US03 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux définir 3 questions secrètes pour chaque trusted contact afin de garantir que seule la vraie personne peut accéder aux données. |
| Critères d'acceptation✓ L'user choisit 3 questions dans la bibliothèque administrée par Relais (pas de création libre)✓ Les questions sont publiques — leur texte vient de checkin_questions, lisible sans déchiffrement✓ Les réponses ne sont JAMAIS stockées — elles servent uniquement à dériver K_i (sur le device du contact)✓ L'app suggère des exemples de bonnes questions : précises, stables dans le temps, connues uniquement du contact✓ L'app déconseille les questions à réponses devinables : date de naissance, ville natale, prénom de la mère✓ L'user peut modifier les questions à tout moment — cela invalide les parts Si_enc et les recréeNote techniqueLes réponses ne transitent jamais sur le réseau (DEC-13 vérification 100% côté client). Les questions modifiées nécessitent de ressaisir les réponses pour recréer les parts. |

| E3-US04 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux configurer qui reçoit quoi au final par catégorie afin de personnaliser la transmission selon mes souhaits. |
| Critères d'acceptation✓ Pour chaque catégorie (comptes, messages, finances), l'user désigne le data recipient parmi ses trusted contacts✓ Le data recipient doit avoir le rôle correspondant à la catégorie✓ Un même contact peut recevoir plusieurs catégories✓ La configuration est affichée sous forme de résumé clair avant activation⚠️ ErrataDEC-23 : L'option 'autre personne (email uniquement)' est supprimée. Le destinataire est toujours un trusted contact avec rôle — une personne externe sans part Shamir ne peut pas déchiffrer sans que Relais voie le clair, ce qui violerait DEC-14. |

| E3-US05 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux configurer la durée du silence avant déclenchement et la fréquence des check-ins afin d'adapter le système à mon mode de vie. |
| Critères d'acceptation✓ Durée du silence configurable : 1 mois / 3 mois / 6 mois (défaut : 3 mois)✓ Fréquence des check-ins configurable : hebdomadaire / bimensuel (toutes les 2 semaines) / mensuel (défaut : mensuel)✓ L'app affiche la cohérence : 'Avec ces paramètres, vous aurez 3 relances avant déclenchement'✓ Ces paramètres sont modifiables à tout moment✓ Toute modification requiert confirmation par PIN⚠️ ErrataErrata : 'Bimestriel' corrigé en 'Bimensuel (toutes les 2 semaines)'. La valeur en base est checkin_frequency_weeks = 2 (semaines), ce qui correspond bien à 'toutes les 2 semaines'. |

| E3-US06 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux activer la transmission après avoir tout configuré afin de rendre mon coffre opérationnel. |
| Critères d'acceptation✓ Un récapitulatif complet est affiché avant l'activation : contacts, rôles, schéma, délais✓ L'activation requiert une confirmation par PIN (step-up 'activate_transmission')✓ Après activation : les parts Si_enc sont créées, signées Ed25519, et stockées sur Storj✓ Les contacts reçoivent un email de désignation (type contact_designated) — sans données sensibles✓ Le statut du tableau de bord passe à 'Transmission active'✓ L'user peut désactiver la transmission à tout moment — requiert PIN |

| E3-US07 | P2 — Moyenne | Persona : Adjoua |
| En tant qu'utilisateur, je veux modifier la configuration de la transmission après activation afin de la garder à jour si ma vie change. |
| Critères d'acceptation✓ L'user peut modifier : les contacts, les rôles, les questions, les délais✓ Toute modification requiert PIN✓ Si les questions secrètes d'un contact changent, ses parts Si_enc sont recréées automatiquement✓ Un email de notification est envoyé aux contacts concernés par le changement✓ Les anciennes parts Si_enc sont supprimées immédiatement après recréationNote techniqueLes contacts et le schéma N-of-M sont figés une fois la transmission active. Pour les modifier : désactiver → modifier → réactiver (E3-US07 'recréées automatiquement'). |

| E4 — Check-in mensuel et dead man's switchTout ce qui concerne le mécanisme de preuve de vie, les relances, et le déclenchement automatique de la transmission. |

| E4-US01 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux recevoir une notification de check-in mensuel et y répondre via un mini-jeu afin de confirmer ma présence sans que ce soit une corvée. |
| Critères d'acceptation✓ La notification est envoyée selon la fréquence configurée par l'user✓ La notification est ludique — pas d'alerte morbide✓ En ouvrant l'app : un mini-jeu ou une énigme est présenté (fourni par le serveur, bibliothèque intégrée)✓ Si la réponse est correcte : check-in validé, compteur remis à zéro✓ Si la réponse est incorrecte : l'user peut réessayer✓ Le check-in nécessite de valider le mini-jeu — la simple ouverture de l'app ne suffit pasNote techniqueDEC-33 : le mini-jeu est fourni et vérifié côté serveur (bibliothèque intégrée api/checkin/games.ts). Jeton opaque — la réponse n'est jamais transmise au client. |

| E4-US02 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux recevoir des relances progressives si j'oublie mon check-in afin d'avoir plusieurs chances de répondre avant que la transmission ne se déclenche. |
| Critères d'acceptation✓ Relance 1 : notification push + email, 7 jours après le check-in manqué✓ Relance 2 : email urgent, 14 jours après le check-in manqué✓ Relance 3 : email final, 21 jours après le check-in manqué✓ Chaque relance contient un lien direct vers le check-in dans l'app✓ Si l'user répond à n'importe quelle relance : processus annulé, compteur remis à zéro✓ Déclenchement après 3 relances ET silence_duration_months écoulé (DEC-35) |

| E4-US03 | P0 — Critique | Persona : Système |
| En tant que système, le dead man's switch doit se déclencher automatiquement après silence prolongé afin de notifier les trusted contacts sans action humaine de la plateforme. |
| Critères d'acceptation✓ Déclenchement après 3 relances sans réponse ET silence_duration_months écoulé✓ Les trusted contacts reçoivent un email automatique (type transmission_contact)✓ L'email contient un lien vers l'app — pas de données sensibles✓ Le déclenchement est loggé avec timestamp✓ Le déclenchement est asynchrone — les contacts peuvent répondre à leur rythmeNote techniqueLe système ne détermine jamais si l'user est mort. Il constate uniquement qu'il ne répond plus. Le message aux contacts doit refléter cette nuance. |

| E4-US04 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux pouvoir mettre en pause le dead man's switch pendant une période définie afin de ne pas déclencher de fausse alerte si je sais que je serai injoignable. |
| Critères d'acceptation✓ L'user peut activer un mode 'Voyage' ou 'Pause' depuis les paramètres✓ Durée configurable : 1 semaine / 1 mois / 3 mois✓ Requiert PIN pour activer✓ Le mode pause est affiché clairement sur le tableau de bord✓ Un rappel est envoyé 3 jours avant la fin de la pause (email pause_ending + push)✓ La pause ne peut pas être indéfinie — maximum 3 mois✓ La reprise en fin de pause est automatique — aucune action requise |

| E4-US05 | P2 — Moyenne | Persona : Adjoua |
| En tant qu'utilisateur, je veux voir l'historique de mes check-ins afin de suivre mon assiduité et vérifier que le système fonctionne. |
| Critères d'acceptation✓ Une section Historique affiche les dates des check-ins validés✓ Les relances envoyées sont également visibles✓ Le prochain check-in est affiché avec une date claire✓ Les données d'historique sont des métadonnées — pas de contenu sensible✓ Le streak actuel et les badges obtenus sont affichés (DEC-34) |

| E5 — Expérience du trusted contactTout ce qui concerne la réception de la notification, la vérification d'identité, et l'accès aux données par les contacts désignés. |

| E5-US01 | P0 — Critique | Persona : Hervé |
| En tant que trusted contact, je veux recevoir un email clair et humain m'expliquant ce qui se passe afin de savoir quoi faire sans être perdu. |
| Critères d'acceptation✓ L'email a un objet sobre et humain — pas alarmiste✓ L'email peut inclure le prénom de l'owner si fourni dans notification_enc (owner_display_name, 60 chars max)✓ Aucune donnée sensible dans l'email✓ L'email est rédigé en français (ou dans la langue configurée par l'user)✓ Le bouton mène vers l'app Relais — téléchargement si pas installée, ouverture directe si installéeNote techniqueHervé est probablement en deuil. Le ton de l'email est crucial. Sobre, chaleureux, actionnable. Pas de jargon. |

| E5-US02 | P0 — Critique | Persona : Hervé |
| En tant que trusted contact, je veux vérifier mon identité en répondant aux questions secrètes afin de prouver que je suis bien la personne désignée. |
| Critères d'acceptation✓ L'app affiche les 3 questions choisies par l'owner dans la bibliothèque (texte public, pas de déchiffrement)✓ Hervé saisit ses réponses dans l'app✓ Maximum 5 tentatives incorrectes — après : contact bloqué 24h, les autres contacts sont notifiés (contact_progress)✓ Si les réponses sont correctes : confirmation visuelle et message d'attente✓ Le processus est entièrement local — les réponses ne transitent pas sur le réseau |

| E5-US03 | P0 — Critique | Persona : Hervé |
| En tant que trusted contact, je veux être notifié quand l'autre contact a confirmé son identité afin de savoir quand j'aurai accès aux informations. |
| Critères d'acceptation✓ Hervé reçoit un email contact_progress quand un autre contact confirme✓ L'app indique le statut : 'X contact(s) sur N ont confirmé'✓ L'accès est déverrouillé automatiquement dès que N contacts ont confirmé✓ Si l'escrow expire (72h) avant que N contacts confirment : le process repart |

| E5-US04 | P0 — Critique | Persona : Hervé |
| En tant que trusted contact, je veux accéder aux informations de façon guidée par niveau d'urgence afin de savoir quoi faire en premier. |
| Critères d'acceptation✓ Les informations sont présentées en 3 sections : Immédiat / Sous 30 jours / A votre discrétion✓ Chaque compte affiche le nom du service et les instructions rédigées par l'user✓ Les mots de passe sont masqués par défaut — révélables sur pression✓ Hervé peut marquer chaque tâche comme 'Fait'✓ La progression est conservée sur le device du contact✓ L'accès expire 30 jours après déverrouillage — nettoyage automatique |

| E5-US05 | P1 — Haute | Persona : Hervé |
| En tant que trusted contact, je veux confirmer que j'ai traité toutes les informations afin de déclencher la suppression définitive des données sur Relais. |
| Critères d'acceptation✓ Un bouton 'J'ai terminé' est disponible après avoir marqué au moins une tâche✓ Une confirmation est demandée avant suppression : 'Les données seront définitivement supprimées. Cette action est irréversible.'✓ Après confirmation : toutes les données chiffrées sont supprimées de Storj et PostgreSQL✓ Un email de confirmation est envoyé à tous les contacts✓ Seul le log de transmission (date, statut) est conservé — pas de contenu |

| E6 — Sécurité et paramètres du compteTout ce qui concerne la gestion des paramètres de sécurité, la récupération du compte, et les préférences utilisateur. |

| E6-US01 | P0 — Critique | Persona : Adjoua |
| En tant qu'utilisateur, je veux récupérer l'accès à mon compte depuis un nouveau device en utilisant mes 12 mots de récupération afin de ne pas perdre mes données si je change de téléphone. |
| Critères d'acceptation✓ L'user saisit ses 12 mots BIP39 dans l'ordre exact✓ L'app vérifie les mots via challenge-response Ed25519 — le seed ne transite jamais sur le réseau✓ K1, K2, K3 sont recalculées depuis le seed✓ Le backup chiffré P2 est téléchargé depuis Storj et déchiffré localement✓ L'user définit un nouveau PIN et reconfigure PIN/biométrie✓ Si les 12 mots sont incorrects : message d'erreur clair, nouvelle tentative possible✓ Un email restore_succeeded est envoyé sur l'adresse enregistrée après restauration réussieNote techniqueSi l'user a perdu ses 12 mots ET son accès, aucune récupération n'est possible. Cette politique doit être communiquée clairement lors de l'onboarding. |

| E6-US02 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux activer le 2FA TOTP afin d'ajouter une couche de sécurité supplémentaire à mon compte. |
| Critères d'acceptation✓ L'user peut activer le TOTP depuis les paramètres de sécurité✓ L'app affiche un QR code à scanner avec Google Authenticator ou Authy✓ L'user doit saisir un code TOTP valide pour confirmer l'activation✓ À l'activation : 8 codes de récupération d'urgence sont générés et affichés une seule fois✓ Une fois activé, le TOTP est requis à chaque connexion sur un nouveau device✓ Désactivation du TOTP requiert PIN + code TOTP valide✓ Si TOTP indisponible : un code de récupération peut être utilisé à la place (usage unique) |

| E6-US03 | P1 — Haute | Persona : Adjoua |
| En tant qu'utilisateur, je veux changer mon mot de passe afin de maintenir la sécurité de mon compte. |
| Critères d'acceptation✓ L'user doit saisir l'ancien mot de passe avant de définir le nouveau✓ PIN requis en plus pour confirmer (step-up change_password)✓ Le nouveau mot de passe doit respecter les règles de complexité✓ Après changement : un email password_changed est envoyé — les clés K1/K2/K3 ne changent pas (dérivées du seed, pas du mot de passe)✓ Toutes les sessions actives sur d'autres devices sont invalidées⚠️ ErrataE6-US03 : 'K1 K2 K3 sont recalculées, P1 rechiffré, P2 mis à jour' est obsolète depuis DEC-02/05. Les clés viennent du seed, pas du mot de passe. Rien n'est rechiffré après un changement de mot de passe. |

| E6-US04 | P2 — Moyenne | Persona : Adjoua |
| En tant qu'utilisateur, je veux activer le mode Pause du dead man's switch avant un voyage afin d'éviter une fausse alerte. |
| Critères d'acceptation✓ L'user accède au mode Pause depuis les paramètres de transmission✓ Durée configurable : 1 semaine / 1 mois / 3 mois maximum✓ PIN requis pour activer✓ Le tableau de bord affiche clairement que le mode Pause est actif avec la date de fin✓ Un rappel est envoyé 3 jours avant expiration (email pause_ending + push)✓ La reprise en fin de pause est automatique — aucune action requise✓ Le mode Pause ne peut pas être renouvelé automatiquement |

| E6-US05 | P3 — Basse | Persona : Adjoua |
| En tant qu'utilisateur, je veux changer la langue de l'app entre français et anglais afin de l'utiliser dans ma langue préférée. |
| Critères d'acceptation✓ L'app est disponible en français et en anglais dès V1✓ Le changement de langue est disponible dans les paramètres✓ Le changement s'applique immédiatement sans redémarrage✓ La langue par défaut est détectée depuis les paramètres système du device✓ Tous les contenus UI, notifications, et emails respectent la langue choisie |

— Fin des User Stories v1.1 — 35 stories — 6 épiques — Erratas E1-US03, E3-US04, E3-US05 appliqués
