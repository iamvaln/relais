RELAIS
Passe le relais, pas le chaos.
Dossier Produit — Version 1.0
Avril 2026 — Confidentiel
# 1. Analyse Business
## 1.1 Le Problème
À la mort d'une personne, ses proches font face à trois réalités simultanées :
- Des abonnements qui continuent de prélever — Canal+, Netflix, Spotify, SaaS divers — pendant des mois
- Des comptes inaccessibles — photos, emails, réseaux sociaux, portefeuilles crypto
- Aucun mode d'emploi — personne ne sait quoi fermer, dans quel ordre, ni comment
En Afrique francophone, le problème est amplifié par l'absence de culture notariale chez les jeunes actifs et l'essor rapide des services fintech locaux. Il n'existe aucune solution pensée pour ce contexte.
## 1.2 Le Marché
Cible principale
Jeunes actifs urbains, 25–45 ans, Cameroun en priorité, Afrique francophone ensuite. Critères : smartphone, au moins 3 abonnements digitaux actifs, revenus stables.
Taille estimée
| Marché | Population cible | Pénétration 1% | Revenu à 10 000 FCFA/an |
| Cameroun (V1) | ~4 millions | 40 000 users | 400M FCFA |
| Afrique francophone (V2) | ~20 millions | 200 000 users | 2Mds FCFA |

## 1.3 Analyse Concurrentielle
| Produit | Forces | Faiblesses |
| Google Inactive Account Manager | Gratuit, intégré à Gmail | Google uniquement, pas de vault |
| Apple Digital Legacy | Natif iOS | Apple uniquement, pas de contrôle fin |
| 1Password Emergency Kit | Solide techniquement | Pas de dead man's switch, 100% occidental |
| Bitwarden | Open source, fiable | Aucune logique de transmission |
| Relais ✓ | Pensé pour l'Afrique, vault + transmission + check-in | À construire |

Conclusion : il n'existe rien de pensé pour le marché africain francophone. Le terrain est libre.
## 1.4 Modèle de Revenus
| Plan | Prix | Contenu |
| Gratuit | 0 FCFA | 5 comptes, 2 trusted contacts (minimum incompressible par design de sécurité), check-in manuel |
| Premium | 10 000 FCFA/an | Vault illimité, jusqu'à 5 trusted contacts, rôles différenciés, messages personnels illimités, capsule temps |

Point d'équilibre : ~500 utilisateurs premium couvrent les coûts opérationnels de base.
Note : les 2 trusted contacts minimum sont incompressibles — par design de sécurité, le split cryptographique exige au minimum deux personnes distinctes. Ce n'est pas une feature premium, c'est une contrainte architecturale.
## 1.5 Coûts Estimés
- Hébergement + stockage vault chiffré : < 50$/mois pour les 2 premières années
- Notifications email/push : < 20$/mois au démarrage
- Développement : porté par la fondatrice en solo (V1)
- Acquisition : levier communautaire Techies Connect' — coût quasi nul au lancement
## 1.6 Risques
| Risque | Niveau | Mitigation |
| Adoption lente — sujet tabou | Élevé | Angle 'protection des proches' — jamais 'préparer sa mort' |
| Faille de sécurité vault | Critique | Chiffrement côté client, architecture zero-knowledge |
| Déclenchement par erreur | Élevé | Protocole en 3 étapes avant toute transmission |
| Réglementation données | Moyen | Conformité RGPD dès le départ |
| Bus factor fondatrice seule | Moyen | Documentation solide, open source partiel envisageable |

## 1.7 Avantages Compétitifs Durables
- Première sur le marché africain francophone
- Communauté existante — Techies Connect' comme base d'early adopters
- Contexte local natif — fintechs et apps locales intégrées nativement
- Bilingue français/anglais dès le départ
- Architecture de sécurité vérifiable et open source
# 2. Brief Produit
## 2.1 Vision
Permettre à chaque personne de transmettre son patrimoine numérique à ses proches, sans chaos, sans perte, et sans que personne n'ait à fouiller dans l'obscurité au pire moment de leur vie.
## 2.2 La Solution
Une application mobile qui permet à une personne de :
- Enregistrer ses comptes, abonnements et accès dans un vault chiffré
- Organiser ses informations par niveau d'urgence avec des instructions humaines
- Désigner des contacts de confiance avec des rôles différenciés
- Laisser des messages personnels et une capsule temps
- Déclencher automatiquement la transmission si elle disparaît, via un check-in mensuel
## 2.3 Proposition de Valeur
Pour l'utilisateur
Protège tes proches des tracas numériques — en 15 minutes aujourd'hui, pour toujours.
Pour les proches
Tout ce qu'il vous faut, au moment où vous en avez besoin.
## 2.4 Positionnement Sécurité
La sécurité n'est pas une feature — c'est la fondation non-négociable du produit.
Ce qu'on construit
- Chiffrement côté client uniquement — Relais ne voit jamais les données en clair
- Architecture zero-knowledge — les serveurs piratés ne donnent rien d'exploitable
- Split cryptographique — données chiffrées et clé de déchiffrement séparées entre deux trusted contacts distincts
- Autodestruction après confirmation de transmission — aucune donnée orpheline
Ce qu'on dit
Relais ne peut pas lire vos données. Personne ne le peut — sauf vos proches, au moment où ça compte.
Ce qu'on prouve
- Code de chiffrement open source et auditable
- Audit de sécurité indépendant publié dès que le budget le permet
- Explication visuelle simple du fonctionnement dans l'app
## 2.5 Périmètre V1 — MVP
Dans le scope
- Vault : ajout manuel de comptes avec instructions de fermeture
- Organisation par niveau d'urgence (Immédiat / Sous 30 jours / À votre discrétion)
- 2 trusted contacts minimum avec rôles de base
- Check-in mensuel avec mini-jeu / énigme
- Dead man's switch : 3 tentatives de relance → transmission automatique
- Messages personnels par contact
- Autodestruction après confirmation des trusted contacts
Hors scope V1
- Scan automatique des emails
- Capsule temps
- Rôles différenciés avancés
- Dashboard abonnements avec coûts
- Version web
## 2.6 Stack Technique Envisagée
| Composant | Technologie | Justification |
| Frontend | React Native | iOS + Android dès le départ |
| Backend | Node.js | Familier, écosystème riche |
| Chiffrement | libsodium (côté client) | Référence open source, zero-knowledge |
| Stockage vault | Cloudflare R2 | Coût minimal, fiable |
| Notifications | Email + Push | Check-ins et alertes |

# 3. Personas
## Persona 1 — L'Utilisatrice Principale
Adjoua, 31 ans — Douala
Chargée de projet dans une entreprise de télécoms. Célibataire, pas d'enfants, mais elle soutient financièrement ses parents et un petit frère. Très active digitalement — Neero, Netflix, Spotify, Canal+, et plusieurs apps de productivité qu'elle paie sans vraiment s'en souvenir.
Elle a assisté à un enterrement il y a six mois et a vu la famille galérer pour retrouver les documents du défunt. Ça l'a marquée.
Ses douleurs
- Personne dans sa famille ne saurait quoi faire de ses comptes si elle mourait demain
- Elle a peur que ses économies disparaissent dans la nature
- Elle ne veut pas aller chez un notaire — ça lui semble réservé aux vieux et aux riches
- Elle n'a confiance en aucune app qui touche à ses données financières
Ce qui la convaincrait
- Une recommandation d'une personne de confiance dans son réseau tech
- Une explication claire de pourquoi Relais ne peut pas lire ses données
- Une interface simple — elle n'a pas le temps pour un truc compliqué
- Le prix d'un repas par an
## Persona 2 — Le Trusted Contact
Hervé, 35 ans — Yaoundé
Frère aîné d'un utilisateur Relais. Ingénieur civil, marié, deux enfants. Il est le 'responsable' de la famille — celui qu'on appelle quand il y a un problème. Pas très tech, mais il se débrouille. Il utilise WhatsApp et Mobile Money, c'est à peu près tout.
Ce qu'il vit quand il reçoit la notification Relais
- Il est probablement en deuil ou en état de choc
- Il a mille choses à gérer — funérailles, famille, travail
- Il ne comprend pas forcément ce qu'est un 'vault' ou un 'abonnement SaaS'
- Il a besoin d'instructions claires, en français simple, sans jargon
Ce que Relais doit lui offrir
- Un parcours guidé pas à pas, comme une checklist
- Des instructions rédigées par le défunt lui-même
- Une priorité claire : quoi faire en premier, quoi peut attendre
## Persona 3 — L'Early Adopter Communautaire
Rodrigue, 28 ans — Bafoussam
Développeur freelance, membre actif de Techies Connect'. Il a découvert Relais via le podcast ou un post LinkedIn. Il est enthousiaste, il comprend immédiatement la valeur et il va l'installer le jour du lancement.
Sa valeur pour Relais
- Il teste, il remonte des bugs
- Il en parle autour de lui — son réseau est technique et influent
- Il peut devenir ambassadeur communautaire
- Il est le profil qui va lire la doc de sécurité et la valider publiquement
Ce qu'il attend
- Une architecture de sécurité sérieuse et documentée
- Une roadmap publique — il veut voir où va le produit
## Tableau Récapitulatif
|  | Adjoua | Éric | Hervé | Rodrigue |
| Rôle | Utilisatrice principale | Utilisateur principal | Trusted contact | Early adopter |
| Maturité tech | Moyenne-haute | Moyenne | Faible | Très haute |
| Motivation | Protéger ses proches | Répondre à sa femme | Gérer la succession | Tester / évangéliser |
| Risque principal | Méfiance données | Procrastination | Incompréhension | Impatience roadmap |
| Langue | Français dominant | Français/Anglais | Français | Français/Anglais |

# 4. Identité Visuelle
## 4.1 Nom & Slogan
| Élément | Valeur |
| Nom | Relais |
| Slogan principal | Passe le relais, pas le chaos. |
| Slogan alternatif | Ce que tu leur laisses dit qui tu es. |

## 4.2 Direction Logo
Deux R en miroir, dos à dos. Le R gauche est normal, le R droit est son reflet horizontal exact. Leurs tiges verticales sont sur les bords extérieurs. Leurs jambes convergent vers un point doré central — le passage du témoin.
Double lecture intentionnelle : on voit d'abord deux lettres R, puis deux silhouettes humaines se tendant quelque chose.
## 4.3 Palette
| Rôle | Couleur | Hex | Usage |
| R gauche / Celui qui donne | Beige sable chaud | #C4A882 | Éléments primaires clairs |
| R droit / Celui qui reçoit | Brun profond | #8B5C2A | Éléments primaires foncés |
| Point de transmission | Or doux | #F4A335 | Accents, CTAs, moments clés |
| Fond principal | Crème | #FAF8F5 | Background app |
| Texte principal | Brun très foncé | #1A0A00 | Corps de texte |

— Fin du document v1.0 —
Prochaines étapes : Flowcharts, User Stories, Specs Techniques
