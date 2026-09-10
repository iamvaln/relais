export const tokenParams = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: { token: { type: 'string', minLength: 32, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' } },
} as const
export interface TokenParams {
  token: string
}
