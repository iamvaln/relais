// Nouveau device (E6-US01, DEC-04/06) : 12 mots → challenge signé → PIN.
import { router } from 'expo-router'
import { useState } from 'react'
import { RestoreError, WeakPinError, restoreWithWords } from '@relais/app-core'
import { t } from '@/i18n'
import { api } from '@/lib/api'
import { device } from '@/lib/device'
import { messageFor } from '@/lib/errors'
import { keyStore } from '@/state/keystore'
import { openVault } from '@/state/vault'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, PinField, Screen, Title } from '@/ui'

export default function Restore() {
  const lang = useSession((s) => s.language)
  const signOut = useSession((s) => s.signOut)
  const [words, setWords] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { seed } = await restoreWithWords({ api, device }, { words, pin })
      await keyStore.getState().unlockWithSeed(seed)
      setRestoring(true)
      const { sync } = await openVault()
      await sync.restoreAll()
      router.replace('/home')
    } catch (err) {
      if (err instanceof RestoreError) setError(t(lang, 'restore.failed'))
      else if (err instanceof WeakPinError) setError(t(lang, `pin.weak.${err.reason}`))
      else setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'restore.title')}</Title>
      <Body>{restoring ? t(lang, 'restore.vault') : t(lang, 'restore.body')}</Body>
      <Field label={t(lang, 'restore.words')} value={words} onChangeText={setWords} autoCapitalize="none" autoCorrect={false} multiline />
      <PinField label={t(lang, 'pin.field')} value={pin} onChangeText={setPin} />
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'restore.submit')} onPress={() => void submit()} busy={busy} disabled={pin.length !== 6 || words.trim().split(/\s+/).length !== 12} />
      <Button title={t(lang, 'home.signOut')} secondary onPress={() => void signOut().then(() => router.replace('/welcome'))} />
    </Screen>
  )
}
