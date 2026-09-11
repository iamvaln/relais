export const TICKET_CATEGORIES = ['account_locked', 'otp_issue', 'transmission', 'subscription', 'rgpd', 'other'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

export const ticketCreateBody = {
  type: 'object',
  required: ['subject', 'body', 'category'],
  additionalProperties: false,
  properties: {
    /** Requis sans compte connecté ; ignoré avec un token (l'identité vient du compte). */
    email: { type: 'string', format: 'email', maxLength: 254 },
    subject: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', minLength: 1, maxLength: 5000 },
    category: { type: 'string', enum: [...TICKET_CATEGORIES] },
  },
} as const
export interface TicketCreateBody {
  email?: string
  subject: string
  body: string
  category: TicketCategory
}
