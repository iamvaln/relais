// Connexion (E1-US05) : mot de passe, puis 2FA si activée ; ensuite PIN (device connu) ou restauration.
import { router } from 'expo-router'
import { useState } from 'react'
import { login } from '@relais/app-core'
import { t } from '@/i18n'
import { api } from '@/lib/api'
import { messageFor } from '@/lib/errors'
import { sessionStore, useSession } from '@/state/session'
import { Button, ErrorText, Field, Screen, Title } from '@/ui'

export default function Login() {
  const lang = useSession((s) => s.language)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await login({ api }, { email, password })
      if (r.status === 'two_factor') return router.push({ pathname: '/two-factor', params: { temp: r.tempToken } })
      sessionStore.getState().setUser(await api.auth.me())
      router.replace('/')
    } catch (err) {
      setError(messageFor(err, lang, { AUTH_INVALID_CREDENTIALS: 'login.failed', AUTH_ACCOUNT_LOCKED: 'login.locked' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'login.title')}</Title>
      <Field label={t(lang, 'register.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t(lang, 'register.password')} value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'login.submit')} onPress={() => void submit()} busy={busy} disabled={!email || !password} />
      <Button title={t(lang, 'login.forgot')} secondary onPress={() => router.push('/reset-password')} />
      <Button title={t(lang, 'common.back')} secondary onPress={() => router.replace('/welcome')} />
    </Screen>
  )
}
