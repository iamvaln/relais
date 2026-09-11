import { router } from 'expo-router'
import { t } from '@/i18n'
import { keyStore } from '@/state/keystore'
import { useSession } from '@/state/session'
import { Body, Button, Screen, Title } from '@/ui'

export default function Home() {
  const lang = useSession((s) => s.language)
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  return (
    <Screen>
      <Title>{t(lang, 'home.title')}</Title>
      <Body>{user?.full_name ?? ''}</Body>
      <Body>{t(lang, 'home.body')}</Body>
      <Button title={t(lang, 'home.security')} onPress={() => router.push('/settings/security')} />
      <Button
        title={t(lang, 'home.lock')}
        secondary
        onPress={() => {
          keyStore.getState().lock()
          router.replace('/unlock')
        }}
      />
      <Button title={t(lang, 'home.signOut')} secondary onPress={() => void signOut().then(() => router.replace('/'))} />
    </Screen>
  )
}
