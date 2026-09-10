RELAIS
Passe le relais, pas le chaos.
Tracking Plan PostHog — Version 1.0
Avril 2026 — Confidentiel
# 1. Introduction
Ce document définit les événements à tracker dans PostHog pour Relais. Il couvre les trois niveaux d'événements : lifecycle (acquisition → activation → rétention → churn), feature usage (engagement produit), et system events (technique et sécurité).
| Principe de confidentialité : aucun tracking ne doit contenir de données sensibles — pas de contenu du vault, pas d'informations sur les contacts, pas de questions secrètes, pas de données financières. Uniquement des métadonnées comportementales agrégées. |

## 1.1 Outil et configuration
| Paramètre | Valeur | Notes |
| Outil | PostHog Cloud | Self-hosted possible en V2. Gratuit jusqu'à 1M événements/mois. |
| SDK mobile | posthog-react-native | Intégration Expo compatible |
| SDK backend | posthog-node | Pour les événements serveur (DMS, emails) |
| Anonymisation | Activée | IP masquée automatiquement. Pas de PII dans les événements. |
| Session recording | Désactivé | Données trop sensibles pour Relais |
| Feature flags | Activés | Pour A/B tests futurs et progressive rollouts |
| Data residency | EU | Conformité RGPD — serveurs européens |

## 1.2 Métriques clés à surveiller
| Métrique | Définition | Seuil cible V1 |
| Activation rate | % users ayant ajouté ≥1 compte dans les 48h | ≥ 60% |
| Transmission activation | % users ayant activé leur dead man's switch | ≥ 40% |
| Check-in completion rate | % de check-ins validés à temps (avant relance 1) | ≥ 80% |
| Streak moyen | Mois consécutifs de check-in moyen | ≥ 4 mois |
| Premium conversion | % plan free → premium dans les 90 jours | ≥ 10% |
| Churn mensuel | % d'abonnements premium non renouvelés | ≤ 5% |
| Wrapped generation | % users avec ≥ 6 entrées journal dans l'année | ≥ 30% |
| Relay completion rate | % transmissions complétées (contacts ont répondu) | ≥ 85% |

# 2. Identify — Propriétés person
L'appel identify est fait à chaque login et mis à jour à chaque changement de statut significatif.
| // À chaque login réussi et à chaque changement de statutposthog.identify(user_id_hashed, { // jamais l'email en clair // Plan et statut plan: 'free' | 'premium', account_status: 'active' | 'suspended', language: 'fr' | 'en', // Progression onboarding onboarding_completed: true | false, seed_confirmed: true | false, pin_configured: true | false, transmission_active: true | false, // Vault vault_account_count: number, // 0-N vault_categories_used: ['accounts','messages','finances'], // Transmission contact_count: number, // 0-5 schema_n: number, schema_m: number, // Engagement checkin_streak: number, // mois consécutifs journal_entry_count: number, // total entrées carnet last_checkin_days_ago: number, // jours depuis dernier check-in // Dates (pas de PII) days_since_signup: number, subscription_expires_days: number | null,}) |

| user_id_hashed = SHA256(user_id) côté client. PostHog ne reçoit jamais l'UUID réel ni l'email. Le mapping est conservé côté serveur Relais uniquement. |

# 3. Lifecycle events — Acquisition à Churn
| Ces événements tracent le parcours complet d'un utilisateur. Ils alimentent les funnels, les cohortes et les métriques de rétention. |

## 3.1 Acquisition & Activation
| account_createdDéclenché : Après validation OTP email — compte créé en basePropriétés : language, platform ('ios'|'android'), referrerMétrique : Taux d'inscription. Top du funnel. |

| seed_words_confirmedDéclenché : Après que l'user coche 'J'ai noté mes 12 mots'Propriétés : time_on_screen_seconds (combien de temps sur l'écran)Métrique : % d'users qui passent cette étape critique. Signal d'attention. |

| pin_configuredDéclenché : Après création du PIN — onboarding complétéPropriétés : biometric_enabled (true|false)Métrique : Taux de complétion de l'onboarding. |

| first_account_addedDéclenché : Quand l'user ajoute son tout premier compte dans le coffrePropriétés : category ('accounts'|'messages'|'finances'), urgency_level, time_since_signup_hoursMétrique : MÉTRIQUE CLEF — taux d'activation. Événement le plus important du funnel. |

## 3.2 Engagement & Rétention
| app_openedDéclenché : À chaque ouverture active de l'app (foreground après > 5min en background)Propriétés : days_since_last_open, plan, transmission_activeMétrique : DAU/WAU/MAU. Signal de rétention. |

| transmission_activatedDéclenché : Quand l'user active son dead man's switch pour la première foisPropriétés : contact_count, schema_n, schema_m, time_since_signup_daysMétrique : Taux d'activation produit complet. Indicateur d'engagement profond. |

| checkin_completedDéclenché : Après validation réussie de l'énigme du check-in mensuelPropriétés : streak_current, game_type, attempts, journal_answered (true|false), days_before_dueMétrique : Taux de rétention mensuel. Streak = proxy de santé long terme. |

| journal_entry_createdDéclenché : Quand une entrée carnet de vie est enregistréePropriétés : mode ('essential'|'reflective'|'free'), word_count_bucket ('short'|'medium'|'long'), streak_currentMétrique : Engagement carnet. Prédicteur de génération Wrapped. |

| wrapped_generatedDéclenché : Quand le Wrapped annuel est calculé localementPropriétés : year, entry_count, max_streak, exported (true|false)Métrique : Feature engagement. Si exported=true → partage potentiel = acquisition organique. |

## 3.3 Conversion & Churn
| subscription_upgradedDéclenché : Quand un user passe de free à premiumPropriétés : days_since_signup, vault_account_count, transmission_active, trigger ('paywall'|'settings'|'limit_reached')Métrique : Taux de conversion. trigger révèle le déclencheur principal. |

| plan_limit_reachedDéclenché : Quand l'user tente une action bloquée par son plan (ex: 6ème compte en gratuit)Propriétés : limit_type ('accounts'|'contacts'), current_count, planMétrique : Signal d'intention d'upgrade. Alimenter le funnel de conversion. |

| subscription_expiredDéclenché : Quand un abonnement premium expire sans renouvellementPropriétés : subscription_duration_months, vault_account_count, checkin_streak, last_checkin_days_agoMétrique : Churn. Les propriétés révèlent le profil du churner. |

| account_deletedDéclenché : Quand l'user supprime son comptePropriétés : days_since_signup, plan, had_transmission, deletion_source ('settings'|'support')Métrique : Churn radical. À analyser pour identifier les points de friction. |

# 4. Feature usage events — Engagement produit
## 4.1 Coffre (Vault)
| vault_account_addedDéclenché : À chaque ajout de compte dans le coffre (pas seulement le premier)Propriétés : category, urgency_level, vault_total_countMétrique : Volume d'usage du coffre. Distribution par catégorie. |

| vault_account_editedDéclenché : À chaque modification d'un compte existantPropriétés : category, field_changed ('instructions'|'credentials'|'urgency')Métrique : Engagement maintenance. Les users qui éditent sont plus engagés. |

| vault_syncedDéclenché : Après sync réussie vers StorjPropriétés : category, size_bucket ('small'|'medium'|'large'), sync_duration_msMétrique : Santé de la sync. Latences anormales → alertes. |

| vault_restoredDéclenché : Quand l'user restaure son vault sur un nouveau devicePropriétés : platform, time_to_restore_secondsMétrique : UX restauration. Signal critique — si long → friction. |

## 4.2 Configuration transmission
| contact_addedDéclenché : Quand un trusted contact est configuréPropriétés : contact_order, has_k1_role, has_k2_role, has_k3_role, total_contactsMétrique : Profil de la configuration. Distribution des rôles. |

| contact_questions_setDéclenché : Quand les questions secrètes d'un contact sont validéesPropriétés : question_count (toujours 3), contact_orderMétrique : Complétion de la configuration. Si < 100% → friction dans le flow. |

| annual_review_completedDéclenché : Quand l'owner vérifie ses réponses (verify_token check)Propriétés : contacts_verified, contacts_failed, contacts_updatedMétrique : Santé long terme. contacts_failed → questions à risque. |

| transmission_pausedDéclenché : Quand l'user active le mode pausePropriétés : pause_duration_months, checkin_streak, reason_provided (true|false)Métrique : Signal de voyage ou d'absence planifiée. Pas un churn signal. |

| transmission_schema_changedDéclenché : Quand l'user change son schéma N-of-MPropriétés : old_n, old_m, new_n, new_mMétrique : Sophistication de l'usage. Les users qui ajustent sont très engagés. |

## 4.3 Check-in & Carnet
| checkin_game_startedDéclenché : Quand l'user ouvre l'écran du mini-jeuPropriétés : game_type, days_before_dueMétrique : Engagement début check-in. Les abandons entre start et complete = friction. |

| checkin_game_abandonedDéclenché : Quand l'user quitte l'écran sans compléterPropriétés : game_type, time_spent_seconds, attemptsMétrique : Friction dans le mini-jeu. Si élevé → revoir la difficulté. |

| checkin_lateDéclenché : Quand une relance est envoyée (côté backend)Propriétés : relance_number (1|2|3), days_overdue, streak_beforeMétrique : Signal early churn. relance_number=3 → risque de déclenchement accidentel. |

## 4.4 Paramètres & Sécurité
| two_fa_enabledDéclenché : Quand l'user active le TOTP 2FAPropriétés : days_since_signup, planMétrique : Adoption sécurité. Corrélation avec rétention long terme. |

| language_changedDéclenché : Quand l'user change la langue de l'appPropriétés : from_language, to_languageMétrique : Distribution linguistique réelle vs inscription. |

# 5. System events — Backend & Infrastructure
| Ces événements sont envoyés depuis le backend Node.js via posthog-node. Ils ne contiennent jamais de PII ni de données sensibles. |

| dms_triggeredDéclenché : Backend — quand le smart contract Arbitrum déclenche la transmissionPropriétés : contacts_notified, schema_n, schema_m, silence_duration_monthsMétrique : Volume de transmissions déclenchées. Santé du produit. |

| relay_link_openedDéclenché : Backend — quand un trusted contact clique le lien emailPropriétés : hours_since_trigger, contact_orderMétrique : Délai de réaction des contacts. Signal de qualité des contacts choisis. |

| relay_questions_answeredDéclenché : Backend — quand un contact soumet ses réponsesPropriétés : success (true|false), attempts, contact_order, hours_since_triggerMétrique : Taux de réussite des questions. Si failure élevé → qualité des questions. |

| relay_transmission_completedDéclenché : Backend — quand N contacts ont répondu et K est reconstituéePropriétés : total_hours, contacts_who_answered, schema_nMétrique : Délai total de transmission. SLA du produit en conditions réelles. |

| email_deliveredDéclenché : Backend — confirmation Resend de délivrance d'un email critiquePropriétés : email_type ('otp'|'relance_1'|'relance_2'|'relance_3'|'transmission'|'account_event'), successMétrique : Taux de délivrance par type. Identifier les types qui bounced. |

# 6. Funnels clés à configurer dans PostHog
## 6.1 Funnel d'activation
| Étape | Événement | Objectif |
| 1 | account_created | Inscription |
| 2 | seed_words_confirmed | Compréhension onboarding |
| 3 | pin_configured | Onboarding complet |
| 4 | first_account_added | Activation — valeur produit démontrée |
| 5 | transmission_activated | Engagement profond |

| Le drop entre étapes 3 et 4 (pin_configured → first_account_added) est le plus critique. C'est là que l'utilisateur doit comprendre la valeur du produit sans ses contacts encore configurés. |

## 6.2 Funnel de conversion premium
| Étape | Événement | Objectif |
| 1 | plan_limit_reached | Exposition au paywall |
| 2 | subscription_upgraded | Conversion |

Segmenter par trigger ('accounts'|'contacts'|'settings') pour identifier le déclencheur le plus efficace.
## 6.3 Funnel de transmission (post-mortem)
| Étape | Événement | Objectif |
| 1 | dms_triggered | Déclenchement |
| 2 | relay_link_opened | Contact notifié a ouvert le lien |
| 3 | relay_questions_answered (success=true) | Contact a répondu correctement |
| 4 | relay_transmission_completed | Transmission réussie |

# 7. Cohortes à définir
| Cohorte | Définition | Usage |
| Activated users | A fait first_account_added dans les 48h | Baseline rétention — comparaison avec non-activés |
| Power users | checkin_streak ≥ 6 ET journal_entry_count ≥ 6 | Profil de l'utilisateur idéal — feature interviews |
| At-risk users | last_checkin_days_ago > 20 ET transmission_active = true | Relance proactive avant DMS accidentel |
| Churners | subscription_expired dans les 30 derniers jours | Analyse des causes de churn |
| Wrapped eligible | journal_entry_count ≥ 6 dans l'année courante | Notifier pour générer leur Wrapped |
| Conversion targets | plan_limit_reached ET subscription_upgraded IS NULL | Campagne de conversion ciblée |

# 8. Implémentation
## 8.1 Initialisation — React Native
| // src/lib/analytics.tsimport PostHog from 'posthog-react-native'export const posthog = new PostHog( process.env.POSTHOG_API_KEY, { host: 'https://eu.posthog.com', // EU data residency captureApplicationLifecycleEvents: true, captureDeepLinks: false, // pas de deep links sensibles sessionRecording: { androidDebouncerDelayMs: 500, iOSConfig: { maskAllTextInputs: true } } })// Opt-out par défaut — demander consentement en onboarding// posthog.optOut() // par défaut// posthog.optIn() // après consentement user// Helper — jamais envoyer de PIIexport function track(event: string, props?: Record<string, unknown>) { posthog.capture(event, { ...props, // Propriétés globales automatiques '$set_once': { first_seen: new Date().toISOString() } })} |

## 8.2 Identification — jamais de PII
| // src/lib/analytics.tsimport { SHA256 } from 'crypto-js'export function identifyUser(userId: string, props: UserAnalyticsProps) { // Hacher l'UUID pour que PostHog ne connaisse jamais l'ID réel const anonymousId = SHA256(userId).toString() posthog.identify(anonymousId, { plan: props.plan, language: props.language, onboarding_completed: props.onboardingCompleted, transmission_active: props.transmissionActive, vault_account_count: props.vaultAccountCount, contact_count: props.contactCount, checkin_streak: props.checkinStreak, journal_entry_count: props.journalEntryCount, days_since_signup: props.daysSinceSignup, })}// Ce qui N'EST PAS dans identify :// ✗ email, phone, full_name// ✗ ed25519_pk// ✗ contenu du vault// ✗ données des contacts |

## 8.3 Consentement utilisateur
| Le RGPD s'applique. L'utilisateur doit consentir explicitement au tracking analytique. Le tracking de sécurité (tentatives de connexion, blocages) est exclu du consentement car il relève de l'intérêt légitime. |

| // Demander le consentement lors de l'onboarding// Écran : 'Pour améliorer Relais, puis-je collecter des données',// 'd'utilisation anonymisées ? Aucune donnée personnelle ni',// 'contenu de votre coffre n'est collecté.'// Si acceptéawait SecureStore.set('analytics_consent', 'granted')posthog.optIn()// Si refuséawait SecureStore.set('analytics_consent', 'denied')posthog.optOut() // aucun événement envoyé// Révocable dans Paramètres → Confidentialité |

## 8.4 Exemple d'implémentation — check-in
| // src/screens/checkin/CheckinScreen.tsx// Au démarrage de l'écranuseEffect(() => { track('checkin_game_started', { game_type: currentGame.type, days_before_due: daysBeforeDue, })}, [])// Sur abandon (navigation away sans compléter)useEffect(() => { return () => { if (!completed) { track('checkin_game_abandoned', { game_type: currentGame.type, time_spent_seconds: Math.floor((Date.now() - startTime) / 1000), attempts: attemptCount, }) } }}, [completed])// Sur complétionasync function handleCheckinComplete() { await validateCheckin() track('checkin_completed', { streak_current: newStreak, game_type: currentGame.type, attempts: attemptCount, journal_answered: journalAnswered, days_before_due: daysBeforeDue, }) identifyUser(userId, await getUserAnalyticsProps())} |

## 8.5 Events backend — posthog-node
| // src/services/analytics.ts (Node.js backend)import { PostHog } from 'posthog-node'const ph = new PostHog(process.env.POSTHOG_API_KEY, { host: 'https://eu.posthog.com'})// À la fermeture du serveurprocess.on('SIGTERM', () => ph.shutdown())export function trackServer( userId: string, // déjà haché SHA256 event: string, props?: Record<string, unknown>) { ph.capture({ distinctId: userId, event, properties: props })}// Exemple — DMS déclenchétrackServer(hashedUserId, 'dms_triggered', { contacts_notified: contactCount, schema_n: config.schemaN, schema_m: config.schemaM, silence_duration_months: config.silenceDurationMonths,}) |

— Fin du Tracking Plan PostHog v1.0 —
32 événements — 7 funnels — 6 cohortes
