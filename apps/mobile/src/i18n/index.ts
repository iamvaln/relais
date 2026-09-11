// FR d'abord (Cameroun), EN ensuite. Les clés sont typées sur le dictionnaire FR.

import { en } from './en.js'
import { fr } from './fr.js'

export type Language = 'fr' | 'en'
export type MessageKey = keyof typeof fr

const dictionaries: Record<Language, Record<MessageKey, string>> = { fr, en }

export function t(language: Language, key: MessageKey, params: Record<string, string | number> = {}): string {
  const template = dictionaries[language][key] ?? fr[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}
