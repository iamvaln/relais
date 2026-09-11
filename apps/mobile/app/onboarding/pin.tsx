import { router } from 'expo-router'
import { useState } from 'react'
import { WeakPinError } from '@relais/app-core'
import { t } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { keyStore } from '@/state/keystore'
import { pendingSeed } from '@/state/pending-seed'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, PinField, Screen, Title } from '@/ui'

export default function Pin() {
  const lang = useSession((s) => s.language)
  const flow = useSession((s) => s.onboarding)
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!flow) return router.replace('/welcome')
    if (pin !== confirm) return setError(t(lang, 'pin.mismatch'))
    setBusy(true)
    setError(null)
    try {
      const { seed } = await flow.submitPin(pin)
      pendingSeed.set(seed)
      // Le KeyStore reçoit une copie : la biométrie a encore besoin du seed.
      await keyStore.getState().unlockWithSeed(Uint8Array.from(seed))
      router.replace('/onboarding/biometrics')
    } catch (err) {
      if (err instanceof WeakPinError) setError(t(lang, `pin.weak.${err.reason}`))
      else setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'pin.title')}</Title>
      <Body>{t(lang, 'pin.body')}</Body>
      <PinField label={t(lang, 'pin.field')} value={pin} onChangeText={setPin} />
      <PinField label={t(lang, 'pin.confirm')} value={confirm} onChangeText={setConfirm} />
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'common.continue')} onPress={() => void submit()} busy={busy} disabled={pin.length !== 6 || confirm.length !== 6} />
    </Screen>
  )
}
