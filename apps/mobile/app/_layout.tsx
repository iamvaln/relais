import '@/lib/polyfills'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { initPush } from '@/lib/push'
import { keyStore } from '@/state/keystore'
import { themeStore, useTheme } from '@/ui'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })

export default function RootLayout() {
  // Apparence : thème du système, ou la préférence mémorisée sur le device.
  const { scheme, colors } = useTheme()

  // Retour au premier plan : le KeyStore vérifie s'il doit se verrouiller (Frontend §2.1).
  useEffect(() => {
    void themeStore.getState().load()
    initPush()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') keyStore.getState().checkAutoLock()
    })
    return () => sub.remove()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </QueryClientProvider>
  )
}
