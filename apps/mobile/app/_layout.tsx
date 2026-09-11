import '@/lib/polyfills'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { keyStore } from '@/state/keystore'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })

export default function RootLayout() {
  // Retour au premier plan : le KeyStore vérifie s'il doit se verrouiller (Frontend §2.1).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') keyStore.getState().checkAutoLock()
    })
    return () => sub.remove()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  )
}
