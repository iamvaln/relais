// Mot de passe oublié (E1-US05) : OTP par email + 12 mots qui signent.
import { router } from 'expo-router'
import { useState } from 'react'
import { RestoreError, requestPasswordReset, resetPassword } from '@relais/app-core'
import { t } from '@/i18n'
import { api } from '@/lib/api'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title } from '@/ui'

export default function ResetPassword() {
  const lang = useSession((s) => s.language)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [words, setWords] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset(api, email)
      setSent(true)
    } catch (err) {
      setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await resetPassword(api, { email, code, words, newPassword: password })
      setDone(true)
    } catch (err) {
      if (err instanceof RestoreError) setError(t(lang, 'restore.failed'))
      else setError(messageFor(err, lang, { AUTH_OTP_INVALID: 'otp.invalid', AUTH_OTP_EXPIRED: 'otp.invalid' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'reset.title')}</Title>
      <Body>{done ? t(lang, 'reset.done') : t(lang, 'reset.body')}</Body>
      {done ? (
        <Button title={t(lang, 'login.submit')} onPress={() => router.replace('/login')} />
      ) : !sent ? (
        <>
          <Field label={t(lang, 'register.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <ErrorText>{error}</ErrorText>
          <Button title={t(lang, 'reset.send')} onPress={() => void send()} busy={busy} disabled={!email} />
        </>
      ) : (
        <>
          <Field label={t(lang, 'otp.code')} value={code} onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
          <Field label={t(lang, 'restore.words')} value={words} onChangeText={setWords} autoCapitalize="none" autoCorrect={false} multiline />
          <Field label={t(lang, 'reset.newPassword')} value={password} onChangeText={setPassword} secureTextEntry />
          <Body>{t(lang, 'register.passwordHint')}</Body>
          <ErrorText>{error}</ErrorText>
          <Button title={t(lang, 'reset.submit')} onPress={() => void submit()} busy={busy} disabled={code.length !== 6 || !words || !password} />
        </>
      )}
      <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
    </Screen>
  )
}
