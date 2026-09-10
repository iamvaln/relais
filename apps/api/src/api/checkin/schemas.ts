export const answerBody = {
  type: 'object',
  required: ['answer'],
  additionalProperties: false,
  properties: { answer: { type: 'string', minLength: 1, maxLength: 200 } },
} as const
export interface AnswerBody {
  answer: string
}
