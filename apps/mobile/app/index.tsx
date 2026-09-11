// Point d'entrée : décide de l'écran selon la session, le device et le KeyStore.
import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { device } from '@/lib/device'
import { entryRoute } from '@/state/routing'
import { keyStore } from '@/state/keystore'
import { useSession } from '@/state/session'
import { Body, Screen } from '@/ui'

export default function Entry() {
  const session = useSession((s) => s.status)
  const keys = useStore(keyStore, (s) => s.status)
  const [hasSeed, setHasSeed] = useState<boolean | null>(null)
  useEffect(() => {
    void device.hasSeed().then(setHasSeed)
  }, [session, keys])
  if (hasSeed === null) {
    return (
      <Screen>
        <Body>…</Body>
      </Screen>
    )
  }
  return <Redirect href={entryRoute({ session, deviceHasSeed: hasSeed, keys }) as never} />
}
