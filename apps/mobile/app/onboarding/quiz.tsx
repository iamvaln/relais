import { router } from 'expo-router'
import { useState } from 'react'
import { t } from '@/i18n'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title } from '@/ui'

export default function Quiz() {
  const lang = useSession((s) => s.language)
  const flow = useSession((s) => s.onboarding)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [wrong, setWrong] = useState(false)
  const quiz = flow?.state.quiz
  if (!flow || !quiz) return null
  const [ia, ib] = quiz

  return (
    <Screen>
      <Title>{t(lang, 'quiz.title')}</Title>
      <Body>{t(lang, 'quiz.body', { a: ia + 1, b: ib + 1 })}</Body>
      <Field label={t(lang, 'quiz.word', { n: ia + 1 })} value={a} onChangeText={setA} autoCapitalize="none" autoCorrect={false} />
      <Field label={t(lang, 'quiz.word', { n: ib + 1 })} value={b} onChangeText={setB} autoCapitalize="none" autoCorrect={false} />
      <ErrorText>{wrong ? t(lang, 'quiz.wrong') : null}</ErrorText>
      <Button
        title={t(lang, 'common.continue')}
        disabled={!a || !b}
        onPress={() => {
          if (flow.checkQuiz([a, b])) router.replace('/onboarding/pin')
          else setWrong(true)
        }}
      />
    </Screen>
  )
}
