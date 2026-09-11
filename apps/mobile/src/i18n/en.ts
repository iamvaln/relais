import type { fr } from './fr.js'

export const en: Record<keyof typeof fr, string> = {
  'app.name': 'Relais',
  'app.tagline': 'Pass the baton, not the chaos.',
  'health.title': 'Service status',
  'health.apiStatus': 'API: {status}',
  'health.loading': 'Connecting to Relais…',
  'health.offline': 'Cannot reach Relais. Check your connection.',
  'common.retry': 'Retry',
}
