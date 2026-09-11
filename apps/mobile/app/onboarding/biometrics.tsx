import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { wipe } from '@relais/crypto-core'
import { t } from '@/i18n'
import { biometricsAvailable } from '@/lib/device'
import { messageFor } from '@/lib/errors'
import { api } from '@/lib/api'
import { pendingSeed } from '@/state/pending-seed'
import { sessionStore, useSession } from '@/state/session'
import { Body, Button, ErrorText, Screen, Title } from '@/ui'

export default function Biometrics() {
  const lang = useSession((s) => s.language)
  const flow = useSession((s) => s.onboarding)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void biometricsAvailable().then(setAvailable)
  }, [])

  const done = async () => {
    pendingSeed.clear()
    flow?.finish()
    const user = await api.auth.me()
    sessionStore.getState().setUser(user)
    router.replace('/home')
  }

  const enable = async () => {
    const seed = pendingSeed.take()
    if (!flow || !seed) return void done()
    try {
      await flow.enableBiometrics(seed)
      await done()
    } catch (err) {
      setError(messageFor(err, lang))
    } finally {
      wipe(seed)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'biometrics.title')}</Title>
      <Body>{available === false ? t(lang, 'biometrics.unavailable') : t(lang, 'biometrics.body')}</Body>
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'biometrics.enable')} onPress={() => void enable()} disabled={available !== true} />
      <Button title={t(lang, 'biometrics.later')} secondary onPress={() => void done()} />
    </Screen>
  )
}
