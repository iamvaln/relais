// Textes des notifications (E4-US01 : ludique, jamais morbide ; DEC-18 : rien
// d'identifiant). Les mêmes deux phrases quel que soit l'utilisateur.

import type { Locale } from '../email/types.js'
import type { PushType } from './types.js'

type Text = { title: string; body: string; route: string }

const FR: Record<PushType, Text> = {
  checkin_due: { title: 'Un petit signe ?', body: 'Ton check-in Relais t’attend : un jeu de moins d’une minute.', route: '/checkin' },
  checkin_relance_1: { title: 'On pense à toi', body: 'Ton check-in attend depuis quelques jours. Un petit jeu et c’est réglé.', route: '/checkin' },
  pause_ending: { title: 'Ta pause se termine bientôt', body: 'Les check-ins reprennent dans 3 jours. Prolonge-la si tu es encore loin.', route: '/transmission' },
  transmission_triggered: { title: 'Ta transmission est déclenchée', body: 'Tes contacts ont reçu leurs liens. Si tu es là, annule-la maintenant.', route: '/transmission/cancel' },
  contact_answered: { title: 'Un contact a déverrouillé sa part', body: 'Une part de ton coffre vient d’être ouverte. Si ce n’est pas prévu, annule la transmission.', route: '/transmission/cancel' },
  contact_blocked: { title: 'Un contact est bloqué', body: 'Cinq mauvaises réponses : accès bloqué 24 h. Si tu es là, annule la transmission.', route: '/transmission/cancel' },
}

const EN: Record<PushType, Text> = {
  checkin_due: { title: 'A quick hello?', body: 'Your Relais check-in is waiting: a game under a minute.', route: '/checkin' },
  checkin_relance_1: { title: 'Thinking of you', body: 'Your check-in has been waiting a few days. A quick game and you’re done.', route: '/checkin' },
  pause_ending: { title: 'Your pause ends soon', body: 'Check-ins resume in 3 days. Extend it if you are still away.', route: '/transmission' },
  transmission_triggered: { title: 'Your transmission is triggered', body: 'Your contacts got their links. If you are here, cancel it now.', route: '/transmission/cancel' },
  contact_answered: { title: 'A contact unlocked their share', body: 'A share of your vault was just opened. If this is unexpected, cancel the transmission.', route: '/transmission/cancel' },
  contact_blocked: { title: 'A contact is blocked', body: 'Five wrong answers: access blocked for 24 h. If you are here, cancel the transmission.', route: '/transmission/cancel' },
}

export function renderPush(type: PushType, locale: Locale): Text {
  return (locale === 'en' ? EN : FR)[type]
}
