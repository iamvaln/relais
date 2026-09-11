import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { completeTwoFactor } from '@relais/app-core'
import { t } from '@/i18n'
import { api } from '@/lib/api'
import { messageFor } from '@/lib/errors'
import { sessionStore, useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title } from '@/ui'

export default function TwoFactor() {
  const lang = useSession((s) => s.language)
  const { temp } = useLocalSearchParams<{ temp: string }>()
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await completeTwoFactor(api, recovery ? { tempToken: temp, recoveryCode: code } : { tempToken: temp, code })
      sessionStore.getState().setUser(await api.auth.me())
      router.replace('/')
    } catch (err) {
      setError(messageFor(err, lang, { AUTH_2FA_INVALID: 'twoFactor.invalid', AUTH_TOKEN_EXPIRED: 'twoFactor.invalid' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'twoFactor.title')}</Title>
      <Body>{t(lang, 'twoFactor.body')}</Body>
      <Field label={t(lang, 'twoFactor.code')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} keyboardType={recovery ? 'default' : 'number-pad'} />
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'common.continue')} onPress={() => void submit()} busy={busy} disabled={!code} />
      <Button title={recovery ? t(lang, 'twoFactor.useTotp') : t(lang, 'twoFactor.useRecovery')} secondary onPress={() => setRecovery(!recovery)} />
    </Screen>
  )
}
