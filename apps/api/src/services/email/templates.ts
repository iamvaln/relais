// Templates FR / EN. Texte seul pour la V1 — sobre, chaleureux, sans jargon.
//
// Règle absolue (Backend Specs §5.3) : jamais de donnée sensible dans un
// email. Un OTP à 10 minutes et un prénom, c'est tout ce qui y passe.

import type { EmailType, Locale, RenderedEmail } from './types.js'

type Params = Record<string, string>
type Template = (p: Params) => RenderedEmail

const fr: Record<EmailType, Template> = {
  otp_registration: (p) => ({
    subject: 'Votre code Relais',
    text: `Bonjour ${p.name ?? ''},\n\nVoici votre code de vérification : ${p.code}\n\nIl est valable ${p.minutes} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.\n\nRelais`,
  }),
  otp_email_change: (p) => ({
    subject: 'Confirmez votre nouvelle adresse',
    text: `Bonjour,\n\nVoici votre code pour confirmer votre nouvelle adresse email : ${p.code}\n\nIl est valable ${p.minutes} minutes.\n\nRelais`,
  }),
  otp_password_reset: (p) => ({
    subject: 'Réinitialisation de votre mot de passe',
    text: `Bonjour,\n\nVoici votre code pour réinitialiser votre mot de passe : ${p.code}\n\nIl est valable ${p.minutes} minutes. Si vous n'avez rien demandé, votre compte reste protégé : ce code seul ne suffit pas.\n\nRelais`,
  }),
  checkin_relance_1: (p) => ({
    subject: 'Un petit signe ?',
    text: `Bonjour ${p.name ?? ''},\n\nVotre check-in Relais attend depuis quelques jours. Un jeu de moins d'une minute suffit : ${p.link}\n\nÀ bientôt,\nRelais`,
  }),
  checkin_relance_2: (p) => ({
    subject: 'Relais — nous n’avons pas eu de nouvelles',
    text: `Bonjour ${p.name ?? ''},\n\nCela fait deux semaines sans check-in. Si tout va bien, un simple passage dans l'app suffit : ${p.link}\n\nRelais`,
  }),
  checkin_relance_3: (p) => ({
    subject: 'Relais — dernier rappel avant transmission',
    text: `Bonjour ${p.name ?? ''},\n\nSans réponse de votre part d'ici sept jours, vos contacts de confiance seront prévenus, comme vous l'avez configuré. Un seul geste l'annule : ${p.link}\n\nRelais`,
  }),
  contact_designated: (p) => ({
    subject: `${p.owner ?? 'Un proche'} vous a désigné comme contact de confiance`,
    text: `Bonjour,\n\n${p.owner ?? 'Une personne qui vous fait confiance'} vous a choisi comme contact de confiance sur Relais. Rien à faire pour l'instant : le moment venu, vous recevrez un message avec la marche à suivre.\n\nPour comprendre ce rôle : ${p.link}\n\nRelais`,
  }),
  pause_ending: (p) => ({
    subject: 'Relais — ta pause se termine dans trois jours',
    text: `Bonjour ${p.name ?? ''},\n\nTa pause se termine le ${p.date}. Les check-ins reprendront ensuite au rythme habituel. Si tu es encore loin, tu peux la prolonger depuis l'app : ${p.link}\n\nRelais`,
  }),
  contact_progress: (p) => ({
    subject: 'Relais — du nouveau sur une transmission',
    text: `Bonjour,\n\n${p.event === 'blocked' ? 'Un autre contact de confiance a épuisé ses tentatives et est bloqué 24 heures.' : 'Un autre contact de confiance a terminé sa part.'} Vous n'avez rien à faire de plus si vous avez déjà répondu.\n\nRelais`,
  }),
  transmission_contact: (p) => ({
    subject: `${p.owner ?? 'Un proche'} vous a confié quelque chose`,
    text: `Bonjour,\n\n${p.owner ?? 'Une personne qui vous fait confiance'} vous a désigné pour recevoir des informations importantes, à ouvrir au moment voulu.\n\n${p.message ?? ''}\n\nPour commencer, suivez ce lien : ${p.link}\n\nPrenez votre temps. Nous sommes là si besoin : support@relais.app\n\nRelais`,
  }),
  account_suspended: () => ({
    subject: 'Votre compte Relais a été suspendu',
    text: `Bonjour,\n\nVotre compte a été suspendu. Vos données sont conservées et votre transmission est mise en pause. Contactez-nous pour en savoir plus : support@relais.app\n\nRelais`,
  }),
  account_unblocked: () => ({
    subject: 'Votre compte Relais a été débloqué',
    text: `Bonjour,\n\nVotre compte a été débloqué suite à votre demande de support. Vous pouvez vous reconnecter.\n\nRelais`,
  }),
  subscription_expiring: (p) => ({
    subject: 'Votre abonnement Relais expire bientôt',
    text: `Bonjour,\n\nVotre abonnement Premium expire le ${p.date}. Renouvelez-le pour garder tous vos contacts et votre coffre illimité.\n\nRelais`,
  }),
  subscription_expired: () => ({
    subject: 'Votre abonnement Relais a expiré',
    text: `Bonjour,\n\nVotre abonnement Premium a expiré. Vos données restent en sécurité ; certaines fonctions sont limitées au plan gratuit jusqu'au renouvellement.\n\nRelais`,
  }),
  account_locked: (p) => ({
    subject: 'Tentatives de connexion à votre compte Relais',
    text: `Bonjour,\n\nPlusieurs tentatives de connexion ont échoué. Par précaution, votre compte est verrouillé pendant ${p.minutes} minutes. Si ce n'était pas vous, changez votre mot de passe dès que possible.\n\nRelais`,
  }),
  password_changed: () => ({
    subject: 'Votre mot de passe Relais a été changé',
    text: `Bonjour,\n\nVotre mot de passe vient d'être modifié et vos autres sessions ont été fermées. Si ce n'était pas vous, contactez-nous immédiatement : support@relais.app\n\nRelais`,
  }),
  restore_succeeded: () => ({
    subject: 'Votre coffre Relais a été restauré sur un nouvel appareil',
    text: `Bonjour,\n\nVos 12 mots viennent d'être utilisés pour restaurer votre coffre sur un nouvel appareil. Si ce n'était pas vous, contactez-nous immédiatement : support@relais.app\n\nRelais`,
  }),
  two_factor_enabled: () => ({
    subject: 'Double authentification activée',
    text: `Bonjour,\n\nLa double authentification est maintenant active sur votre compte. Gardez vos codes de secours en lieu sûr.\n\nRelais`,
  }),
  two_factor_disabled: () => ({
    subject: 'Double authentification désactivée',
    text: `Bonjour,\n\nLa double authentification a été désactivée sur votre compte. Si ce n'était pas vous, contactez-nous immédiatement : support@relais.app\n\nRelais`,
  }),
}

const en: Record<EmailType, Template> = {
  otp_registration: (p) => ({
    subject: 'Your Relais code',
    text: `Hello ${p.name ?? ''},\n\nHere is your verification code: ${p.code}\n\nIt is valid for ${p.minutes} minutes. If you did not request this, you can safely ignore this message.\n\nRelais`,
  }),
  otp_email_change: (p) => ({
    subject: 'Confirm your new address',
    text: `Hello,\n\nHere is your code to confirm your new email address: ${p.code}\n\nIt is valid for ${p.minutes} minutes.\n\nRelais`,
  }),
  otp_password_reset: (p) => ({
    subject: 'Reset your password',
    text: `Hello,\n\nHere is your code to reset your password: ${p.code}\n\nIt is valid for ${p.minutes} minutes. If you did not ask for this, your account remains protected: this code alone is not enough.\n\nRelais`,
  }),
  checkin_relance_1: (p) => ({
    subject: 'A quick sign of life?',
    text: `Hello ${p.name ?? ''},\n\nYour Relais check-in has been waiting a few days. A game of under a minute is all it takes: ${p.link}\n\nSee you soon,\nRelais`,
  }),
  checkin_relance_2: (p) => ({
    subject: 'Relais — we have not heard from you',
    text: `Hello ${p.name ?? ''},\n\nTwo weeks without a check-in. If all is well, simply opening the app is enough: ${p.link}\n\nRelais`,
  }),
  checkin_relance_3: (p) => ({
    subject: 'Relais — final reminder before transmission',
    text: `Hello ${p.name ?? ''},\n\nWithout a reply within seven days, your trusted contacts will be notified, as you configured. One tap cancels it: ${p.link}\n\nRelais`,
  }),
  contact_designated: (p) => ({
    subject: `${p.owner ?? 'Someone close to you'} named you as a trusted contact`,
    text: `Hello,\n\n${p.owner ?? 'Someone who trusts you'} chose you as a trusted contact on Relais. Nothing to do for now: when the time comes, you will receive a message with the next steps.\n\nAbout this role: ${p.link}\n\nRelais`,
  }),
  pause_ending: (p) => ({
    subject: 'Relais — your pause ends in three days',
    text: `Hello ${p.name ?? ''},\n\nYour pause ends on ${p.date}. Check-ins will then resume at the usual pace. If you are still away, you can extend it from the app: ${p.link}\n\nRelais`,
  }),
  contact_progress: (p) => ({
    subject: 'Relais — an update on a transmission',
    text: `Hello,\n\n${p.event === 'blocked' ? 'Another trusted contact ran out of attempts and is blocked for 24 hours.' : 'Another trusted contact has completed their part.'} Nothing more to do if you have already answered.\n\nRelais`,
  }),
  transmission_contact: (p) => ({
    subject: `${p.owner ?? 'Someone close to you'} entrusted you with something`,
    text: `Hello,\n\n${p.owner ?? 'Someone who trusts you'} chose you to receive important information, to be opened when the time comes.\n\n${p.message ?? ''}\n\nTo begin, follow this link: ${p.link}\n\nTake your time. We are here if you need us: support@relais.app\n\nRelais`,
  }),
  account_suspended: () => ({
    subject: 'Your Relais account has been suspended',
    text: `Hello,\n\nYour account has been suspended. Your data is kept and your transmission is paused. Contact us to learn more: support@relais.app\n\nRelais`,
  }),
  account_unblocked: () => ({
    subject: 'Your Relais account has been unblocked',
    text: `Hello,\n\nYour account has been unblocked following your support request. You can sign in again.\n\nRelais`,
  }),
  subscription_expiring: (p) => ({
    subject: 'Your Relais subscription expires soon',
    text: `Hello,\n\nYour Premium subscription expires on ${p.date}. Renew to keep all your contacts and your unlimited vault.\n\nRelais`,
  }),
  subscription_expired: () => ({
    subject: 'Your Relais subscription has expired',
    text: `Hello,\n\nYour Premium subscription has expired. Your data stays safe; some features are limited to the free plan until you renew.\n\nRelais`,
  }),
  account_locked: (p) => ({
    subject: 'Sign-in attempts on your Relais account',
    text: `Hello,\n\nSeveral sign-in attempts failed. As a precaution, your account is locked for ${p.minutes} minutes. If this was not you, change your password as soon as possible.\n\nRelais`,
  }),
  password_changed: () => ({
    subject: 'Your Relais password was changed',
    text: `Hello,\n\nYour password was just changed and your other sessions were signed out. If this was not you, contact us immediately: support@relais.app\n\nRelais`,
  }),
  restore_succeeded: () => ({
    subject: 'Your Relais vault was restored on a new device',
    text: `Hello,\n\nYour 12 words were just used to restore your vault on a new device. If this was not you, contact us immediately: support@relais.app\n\nRelais`,
  }),
  two_factor_enabled: () => ({
    subject: 'Two-factor authentication enabled',
    text: `Hello,\n\nTwo-factor authentication is now active on your account. Keep your backup codes somewhere safe.\n\nRelais`,
  }),
  two_factor_disabled: () => ({
    subject: 'Two-factor authentication disabled',
    text: `Hello,\n\nTwo-factor authentication was disabled on your account. If this was not you, contact us immediately: support@relais.app\n\nRelais`,
  }),
}

export function renderEmail(type: EmailType, locale: Locale, params: Params = {}): RenderedEmail {
  return (locale === 'en' ? en : fr)[type](params)
}
