import { router } from 'expo-router'
import { useState } from 'react'
import { t } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title } from '@/ui'

export default function Otp() {
  const lang = useSession((s) => s.language)
  const flow = useSession((s) => s.onboarding)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!flow) return router.replace('/welcome')
    setBusy(true)
    setError(null)
    try {
      await flow.submitOtp(code)
      router.replace('/onboarding/words')
    } catch (err) {
      setError(messageFor(err, lang, { AUTH_OTP_INVALID: 'otp.invalid', AUTH_OTP_EXPIRED: 'otp.invalid' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'otp.title')}</Title>
      <Body>{t(lang, 'otp.body', { email: flow?.state.email ?? '' })}</Body>
      <Field label={t(lang, 'otp.code')} value={code} onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'common.continue')} onPress={() => void submit()} busy={busy} disabled={code.length !== 6} />
      <Button title={t(lang, 'otp.resend')} secondary onPress={() => void flow?.resendOtp().catch((e: unknown) => setError(messageFor(e, lang)))} />
    </Screen>
  )
}
