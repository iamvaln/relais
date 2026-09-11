// Accueil + 3 slides (E1-US04, F1).
import { router } from 'expo-router'
import { useState } from 'react'
import { t } from '@/i18n'
import { useSession } from '@/state/session'
import { Body, Button, Screen, Title } from '@/ui'

const SLIDES = [1, 2, 3] as const

export default function Welcome() {
  const lang = useSession((s) => s.language)
  const start = useSession((s) => s.startOnboarding)
  const [slide, setSlide] = useState<number | null>(null)

  const begin = () => {
    start()
    router.replace('/onboarding/register')
  }

  if (slide === null) {
    return (
      <Screen>
        <Title>{t(lang, 'app.name')}</Title>
        <Body>{t(lang, 'app.tagline')}</Body>
        <Button title={t(lang, 'welcome.create')} onPress={() => setSlide(0)} />
        <Button title={t(lang, 'welcome.login')} secondary onPress={() => router.push('/login')} />
      </Screen>
    )
  }
  const n = SLIDES[slide]!
  const last = slide === SLIDES.length - 1
  return (
    <Screen>
      <Title>{t(lang, `slides.${n}.title`)}</Title>
      <Body>{t(lang, `slides.${n}.body`)}</Body>
      <Button title={last ? t(lang, 'welcome.start') : t(lang, 'common.next')} onPress={() => (last ? begin() : setSlide(slide + 1))} />
      {!last && <Button title={t(lang, 'common.skip')} secondary onPress={begin} />}
    </Screen>
  )
}
