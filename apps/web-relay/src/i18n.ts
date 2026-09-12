// FR d'abord, EN selon le navigateur. Le ton de F4 : simple, humain, guidé.
export type Lang = 'fr' | 'en'

export function browserLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

const fr = {
  title: '{owner} vous a confié quelque chose',
  intro: 'Prenez votre temps. Pour ouvrir ce que {owner} a préparé pour vous, répondez aux trois questions qu’il ou elle a choisies : seules vos réponses ouvrent la porte, et elles ne quittent pas ce navigateur.',
  openApp: 'Ouvrir dans l’app Relais',
  answer: 'Votre réponse',
  submit: 'Vérifier mes réponses',
  wrong: 'Ce n’est pas ça. Il vous reste {left} essai(s). Pensez à la façon dont {owner} aurait écrit la réponse.',
  blocked: 'Trop d’essais : ce lien est en pause 24 heures. Le support peut aider : support@relais.app',
  waitingTitle: 'Merci, {owner} comptait sur vous',
  waitingBody: 'Vos réponses sont bonnes. Il faut encore que {missing} autre(s) contact(s) réponde(nt) pour ouvrir l’accès ({answered} sur {needed}). Vous serez prévenu·e par email.',
  refresh: 'Actualiser',
  accessTitle: 'Ce que {owner} vous a préparé',
  accessBody: 'Tout est là, par ordre d’urgence. Cochez ce que vous avez traité : la progression reste dans ce navigateur, l’accès dure jusqu’au {date}.',
  message: 'Un mot pour vous',
  immediate: 'Immédiat',
  within_30_days: 'Sous 30 jours',
  discretion: 'À votre discrétion',
  empty: 'Rien dans cette section.',
  done: 'Fait',
  todo: 'À faire',
  login: 'Identifiant',
  password: 'Mot de passe',
  reveal: 'Afficher',
  hide: 'Masquer',
  journal: 'Le carnet de vie de {owner}',
  finish: 'J’ai terminé',
  finishConfirm: 'Les données seront définitivement supprimées de Relais. Cette action est irréversible.',
  finishedTitle: 'Merci',
  finishedBody: 'Votre part est faite. Quand chaque contact aura terminé, tout sera effacé de Relais ; seule la date restera. Prenez soin de vous.',
  expired: 'Ce lien n’est plus valable. Si vous pensez que c’est une erreur, écrivez à support@relais.app',
  noToken: 'Ce lien est incomplet. Ouvrez celui reçu par email.',
  error: 'Une erreur est survenue. Réessayez.',
}

const en: Record<keyof typeof fr, string> = {
  title: '{owner} left you something',
  intro: 'Take your time. To open what {owner} prepared for you, answer the three questions they chose: only your answers open the door, and they never leave this browser.',
  openApp: 'Open in the Relais app',
  answer: 'Your answer',
  submit: 'Check my answers',
  wrong: 'Not quite. {left} attempt(s) left. Think about how {owner} would have written the answer.',
  blocked: 'Too many attempts: this link is paused for 24 hours. Support can help: support@relais.app',
  waitingTitle: 'Thank you, {owner} counted on you',
  waitingBody: 'Your answers are right. {missing} more contact(s) must answer to open access ({answered} of {needed}). You will be notified by email.',
  refresh: 'Refresh',
  accessTitle: 'What {owner} prepared for you',
  accessBody: 'Everything is here, by urgency. Tick what you have handled: progress stays in this browser, access lasts until {date}.',
  message: 'A word for you',
  immediate: 'Immediate',
  within_30_days: 'Within 30 days',
  discretion: 'At your discretion',
  empty: 'Nothing in this section.',
  done: 'Done',
  todo: 'To do',
  login: 'Login',
  password: 'Password',
  reveal: 'Show',
  hide: 'Hide',
  journal: '{owner}’s life journal',
  finish: 'I’m done',
  finishConfirm: 'The data will be permanently deleted from Relais. This cannot be undone.',
  finishedTitle: 'Thank you',
  finishedBody: 'Your part is done. Once every contact has finished, everything is erased from Relais; only the date remains. Take care of yourself.',
  expired: 'This link is no longer valid. If you think this is a mistake, write to support@relais.app',
  noToken: 'This link is incomplete. Open the one you received by email.',
  error: 'Something went wrong. Please try again.',
}

export type Key = keyof typeof fr

export function t(lang: Lang, key: Key, params: Record<string, string | number> = {}): string {
  return (lang === 'en' ? en : fr)[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}
