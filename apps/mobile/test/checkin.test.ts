// Check-in et carnet : ce que les écrans disent (E4-US01, E4-US05, E2-US07)
// et où mène une notification push — pur, testé sous Node.

import { describe, expect, it } from 'vitest'
import { badgeKey, checkinLine, routeForNotification } from '../src/lib/checkin'
import { t } from '../src/i18n/index'

describe('checkinLine', () => {
  it('suit le statut : inactif, validé ce mois, échéance à venir, retard', () => {
    expect(checkinLine('fr', { transmission_status: 'inactive', checked_in_this_month: false, next_checkin_due: null, overdue_days: 0 })).toBe('Check-in : active la transmission pour commencer')
    expect(checkinLine('fr', { transmission_status: 'active', checked_in_this_month: true, next_checkin_due: '2026-10-10T00:00:00.000Z', overdue_days: 0 })).toMatch(/^Check-in validé ce mois · prochain le /)
    expect(checkinLine('fr', { transmission_status: 'active', checked_in_this_month: false, next_checkin_due: '2026-10-10T00:00:00.000Z', overdue_days: 0 })).toMatch(/^Prochain check-in le /)
    expect(checkinLine('en', { transmission_status: 'active', checked_in_this_month: false, next_checkin_due: '2026-09-01T00:00:00.000Z', overdue_days: 11 })).toBe('Check-in overdue by 11 days — a quick game and you’re done')
    expect(checkinLine('fr', { transmission_status: 'paused', checked_in_this_month: false, next_checkin_due: null, overdue_days: 0 })).toBe('Check-in : en pause')
  })
})

describe('badgeKey', () => {
  it('chaque badge a sa phrase FR et EN', () => {
    for (const b of ['first_checkin', 'streak_3', 'streak_6', 'streak_12']) {
      expect(t('fr', badgeKey(b))).toBeTruthy()
      expect(t('en', badgeKey(b))).not.toBe(t('fr', badgeKey(b)))
    }
    expect(t('fr', badgeKey('inconnu'))).toBe('Badge')
  })
})

describe('routeForNotification', () => {
  it('n’ouvre que les écrans connus, sinon le tableau de bord', () => {
    expect(routeForNotification({ route: '/checkin' })).toBe('/checkin')
    expect(routeForNotification({ route: '/transmission' })).toBe('/transmission')
    expect(routeForNotification({ route: '/settings/security' })).toBe('/home')
    expect(routeForNotification({ route: 'https://evil.example' })).toBe('/home')
    expect(routeForNotification(undefined)).toBe('/home')
  })
})
