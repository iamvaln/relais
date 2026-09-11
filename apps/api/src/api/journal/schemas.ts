export const JOURNAL_MODES = ['essential', 'reflective', 'free'] as const
export type JournalMode = (typeof JOURNAL_MODES)[number]

export const questionQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { mode: { type: 'string', enum: [...JOURNAL_MODES] } },
} as const
export interface QuestionQuery {
  mode?: JournalMode
}
