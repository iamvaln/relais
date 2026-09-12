// OneSignal (docs/mobile.md §3) : l'utilisateur est connu par
// external_id = SHA256(user_id) ; l'identifiant d'abonnement du device est
// déposé à l'API (POST /auth/push-token) ; un clic ouvre l'écran indiqué par
// la notification, jamais autre chose. Aucune donnée n'est envoyée à OneSignal.

import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { router } from 'expo-router'
import { LogLevel, type NotificationClickEvent, OneSignal } from 'react-native-onesignal'
import { pushExternalId } from '@relais/app-core'
import { api } from './api'
import { routeForNotification } from './checkin'

const extra = (Constants.expoConfig?.extra ?? {}) as { oneSignalAppId?: string }
export const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? extra.oneSignalAppId ?? ''

let initialized = false

/** À l'ouverture de l'app : initialise le SDK et route les clics. Sans App ID, ne fait rien. */
export function initPush(): void {
  if (initialized || !ONESIGNAL_APP_ID) return
  initialized = true
  OneSignal.Debug.setLogLevel(__DEV__ ? LogLevel.Warn : LogLevel.None)
  OneSignal.initialize(ONESIGNAL_APP_ID)
  OneSignal.Notifications.addEventListener('click', (event: NotificationClickEvent) => {
    router.push(routeForNotification(event.notification.additionalData))
  })
  OneSignal.User.pushSubscription.addEventListener('change', (event) => {
    if (event.current.id && event.current.optedIn) void registerSubscription(event.current.id)
  })
}

async function registerSubscription(id: string): Promise<void> {
  if (!api.accessToken) return
  await api.post('/auth/push-token', { token: id, platform: Platform.OS === 'ios' ? 'ios' : 'android' }).catch(() => undefined)
}

/** Après connexion : l'alias haché, puis l'abonnement courant s'il existe déjà. */
export async function pushLogin(userId: string): Promise<void> {
  if (!ONESIGNAL_APP_ID) return
  OneSignal.login(await pushExternalId(userId))
  const id = await OneSignal.User.pushSubscription.getIdAsync()
  if (id) await registerSubscription(id)
}

/** Demande la permission (E4-US01) ; vrai si accordée. */
export async function enablePush(): Promise<boolean> {
  if (!ONESIGNAL_APP_ID) return false
  const granted = await OneSignal.Notifications.requestPermission(true)
  if (granted) {
    const id = await OneSignal.User.pushSubscription.getIdAsync()
    if (id) await registerSubscription(id)
  }
  return granted
}

export async function pushEnabled(): Promise<boolean> {
  if (!ONESIGNAL_APP_ID) return false
  return OneSignal.Notifications.getPermissionAsync()
}

/** À la déconnexion : l'API oublie l'abonnement, OneSignal oublie l'alias. */
export async function pushLogout(): Promise<void> {
  if (!ONESIGNAL_APP_ID) return
  const id = await OneSignal.User.pushSubscription.getIdAsync().catch(() => null)
  if (id && api.accessToken) await api.delete('/auth/push-token', { token: id }).catch(() => undefined)
  OneSignal.logout()
}
