export const answerBody = {
  type: 'object',
  required: ['answer'],
  additionalProperties: false,
  properties: { answer: { type: 'string', minLength: 1, maxLength: 200 } },
} as const
export interface AnswerBody {
  answer: string
}

export const completeBody = {
  type: 'object',
  required: ['checkin_token'],
  additionalProperties: false,
  properties: {
    checkin_token: { type: 'string', minLength: 32, maxLength: 128 },
    /** Entrée du carnet de vie répondue pendant ce check-in (E2-US07). */
    journal_entry_id: { type: 'string', format: 'uuid' },
  },
} as const
export interface CompleteBody {
  checkin_token: string
  journal_entry_id?: string
}
