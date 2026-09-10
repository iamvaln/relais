// Bibliothèque des mini-jeux de check-in (E4-US01 : fun, < 60 s, jamais un
// quiz sur les données du coffre). Le serveur choisit le défi et vérifie la
// réponse — la preuve de vie ne repose pas sur le client.

export type GameType = 'riddle' | 'sequence' | 'sort'
export type Lang = 'fr' | 'en'

export interface Game {
  id: string
  type: GameType
  prompt: Record<Lang, string>
  /** Propositions à afficher (mélangées côté serveur pour `sort`). */
  choices?: Record<Lang, string[]>
  /** Réponses acceptées, par langue — comparées après normalisation. */
  answers: Record<Lang, string[]>
}

const riddle = (id: string, fr: string, en: string, afr: string[], aen: string[]): Game => ({
  id,
  type: 'riddle',
  prompt: { fr, en },
  answers: { fr: afr, en: aen },
})

const sequence = (id: string, seq: string, answer: string): Game => ({
  id,
  type: 'sequence',
  prompt: { fr: `Quel est le nombre suivant ? ${seq}`, en: `What is the next number? ${seq}` },
  answers: { fr: [answer], en: [answer] },
})

const sort = (id: string, items: string[]): Game => {
  const sorted = [...items].sort((a, b) => Number(a) - Number(b)).join(' ')
  return {
    id,
    type: 'sort',
    prompt: {
      fr: 'Range ces nombres du plus petit au plus grand, séparés par des espaces.',
      en: 'Sort these numbers from smallest to largest, separated by spaces.',
    },
    choices: { fr: items, en: items },
    answers: { fr: [sorted], en: [sorted] },
  }
}

export const GAMES: readonly Game[] = [
  riddle('r-jours', "Qu'est-ce qui a des jours mais ne dort jamais ?", 'What has days but never sleeps?', ['calendrier', 'un calendrier', 'le calendrier'], ['calendar', 'a calendar', 'the calendar']),
  riddle('r-clefs', "J'ai des clés mais aucune serrure, des touches mais aucun piano. Qui suis-je ?", 'I have keys but no locks, and I am not a piano. What am I?', ['clavier', 'un clavier', 'le clavier'], ['keyboard', 'a keyboard', 'the keyboard']),
  riddle('r-ombre', 'Je te suis toute la journée mais disparais la nuit. Qui suis-je ?', 'I follow you all day but vanish at night. What am I?', ['ombre', 'mon ombre', "l'ombre", 'une ombre'], ['shadow', 'my shadow', 'a shadow', 'the shadow']),
  riddle('r-oeuf', "Il faut me casser pour m'utiliser. Qui suis-je ?", 'You must break me before you can use me. What am I?', ['oeuf', 'un oeuf', "l'oeuf", 'œuf', 'un œuf'], ['egg', 'an egg', 'the egg']),
  riddle('r-silence', "Plus on en parle, plus il disparaît. Qu'est-ce que c'est ?", 'The more you talk about it, the less there is. What is it?', ['silence', 'le silence'], ['silence', 'the silence']),
  riddle('r-trou', "Plus j'ai de trous, moins je pèse. Qui suis-je ?", 'The more holes I have, the lighter I am. What am I?', ['éponge', 'une éponge', "l'éponge", 'eponge'], ['sponge', 'a sponge', 'the sponge']),
  sequence('s-double', '2, 4, 8, 16, ?', '32'),
  sequence('s-plus3', '5, 8, 11, 14, ?', '17'),
  sequence('s-carres', '1, 4, 9, 16, ?', '25'),
  sequence('s-fibo', '1, 1, 2, 3, 5, 8, ?', '13'),
  sort('t-1', ['9', '3', '7', '1']),
  sort('t-2', ['42', '8', '15', '23']),
  sort('t-3', ['120', '12', '21', '102']),
]

/** Normalisation des réponses : casse, accents, ponctuation, espaces multiples. */
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function isCorrect(game: Game, lang: Lang, raw: string): boolean {
  const given = normalizeAnswer(raw)
  return game.answers[lang].some((a) => normalizeAnswer(a) === given)
}
