// Le client API de l'app : une instance, l'URL vient de app.json (extra.apiUrl)
// ou de EXPO_PUBLIC_API_URL. Les cookies (refresh token) sont gérés par le
// réseau natif — NativeCookieJar ne fait rien.

import Constants from 'expo-constants'
import { ApiClient, NativeCookieJar } from '@relais/api-client'

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string }

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:3000'

export const api = new ApiClient({ baseUrl: API_URL, cookieJar: new NativeCookieJar(), language: 'fr' })
