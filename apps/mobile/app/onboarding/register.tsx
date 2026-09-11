import { router } from 'expo-router'
import { useState } from 'react'
import { t } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title } from '@/ui'

export default function Register() {
  const lang = useSession((s) => s.language)
  const flow = useSession((s) => s.onboarding)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!flow) return router.replace('/welcome')
    setBusy(true)
    setError(null)
    try {
      await flow.submitAccount({ ...form, language: lang })
      router.push('/onboarding/otp')
    } catch (err) {
      setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'register.title')}</Title>
      <Field label={t(lang, 'register.fullName')} value={form.full_name} onChangeText={(v) => setForm({ ...form, full_name: v })} autoCapitalize="words" />
      <Field label={t(lang, 'register.email')} value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t(lang, 'register.phone')} value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
      <Field label={t(lang, 'register.password')} value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry />
      <Body>{t(lang, 'register.passwordHint')}</Body>
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'common.continue')} onPress={() => void submit()} busy={busy} />
    </Screen>
  )
}
