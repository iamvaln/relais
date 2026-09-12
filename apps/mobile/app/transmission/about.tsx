// « Relais peut / ne peut pas » (Décisions d'architecture, DEC-12) : ce que
// le serveur voit et ce qu'il ne verra jamais.
import { router } from 'expo-router'
import { t } from '@/i18n'
import { useSession } from '@/state/session'
import { Body, Button, Screen, Title } from '@/ui'

export default function About() {
  const lang = useSession((s) => s.language)
  return (
    <Screen>
      <Title>{t(lang, 'about.title')}</Title>
      <Body>{t(lang, 'about.can')}</Body>
      {([1, 2, 3] as const).map((i) => (
        <Body key={`can-${i}`}>{`✓ ${t(lang, `about.can.${i}`)}`}</Body>
      ))}
      <Body>{t(lang, 'about.cannot')}</Body>
      {([1, 2, 3] as const).map((i) => (
        <Body key={`cannot-${i}`}>{`✗ ${t(lang, `about.cannot.${i}`)}`}</Body>
      ))}
      <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
    </Screen>
  )
}
