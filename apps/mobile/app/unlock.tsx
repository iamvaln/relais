// Déverrouillage quotidien (Frontend §3.2, Techniques §5.4) : biométrie ou PIN → seed → KeyStore.
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { PinInvalidError, PinLockedError, BiometricRefusedError } from '@relais/app-core'
import { t } from '@/i18n'
import { device } from '@/lib/device'
import { messageFor } from '@/lib/errors'
import { keyStore } from '@/state/keystore'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, PinField, Screen, Title } from '@/ui'

export default function Unlock() {
  const lang = useSession((s) => s.language)
  const signOut = useSession((s) => s.signOut)
  const [pin, setPin] = useState('')
  const [hasBio, setHasBio] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void device.hasBiometrics().then((b) => {
      setHasBio(b)
      if (b) void withBiometrics()
    })
  }, [])

  const finish = async (seed: Uint8Array) => {
    await keyStore.getState().unlockWithSeed(seed)
    router.replace('/home')
  }

  const withBiometrics = async () => {
    try {
      await finish(await device.unlockWithBiometrics())
    } catch (err) {
      if (!(err instanceof BiometricRefusedError)) setError(messageFor(err, lang))
    }
  }

  const withPin = async () => {
    setBusy(true)
    setError(null)
    try {
      await finish(await device.unlockWithPin(pin))
    } catch (err) {
      if (err instanceof PinLockedError) setError(t(lang, 'unlock.locked', { seconds: err.retryInSeconds }))
      else if (err instanceof PinInvalidError) setError(err.retryInSeconds > 0 ? t(lang, 'unlock.locked', { seconds: err.retryInSeconds }) : t(lang, 'unlock.invalid'))
      else setError(messageFor(err, lang))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'unlock.title')}</Title>
      <PinField label={t(lang, 'pin.field')} value={pin} onChangeText={setPin} />
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'unlock.pin')} onPress={() => void withPin()} busy={busy} disabled={pin.length !== 6} />
      {hasBio && <Button title={t(lang, 'unlock.biometrics')} secondary onPress={() => void withBiometrics()} />}
      <Body>{t(lang, 'unlock.forgot')}</Body>
      <Button title={t(lang, 'home.signOut')} secondary onPress={() => void signOut().then(() => router.replace('/login'))} />
    </Screen>
  )
}
