// Le mini-jeu (E4-US01) : défi tiré par le serveur, essais sans limite, puis
// validation ; ensuite la question du mois pour le carnet (E2-US07).
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { type CheckinDone, type CheckinGame, currentMonth } from '@relais/app-core'
import { t } from '@/i18n'
import { badgeKey } from '@/lib/checkin'
import { messageFor } from '@/lib/errors'
import { checkin, journal } from '@/state/checkin'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title, colors } from '@/ui'

export default function Game() {
  const lang = useSession((s) => s.language)
  const [game, setGame] = useState<CheckinGame | null>(null)
  const [answer, setAnswer] = useState('')
  const [wrong, setWrong] = useState(false)
  const [done, setDone] = useState<CheckinDone | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    checkin.game().then(setGame, (err) => setError(messageFor(err, lang)))
  }, [lang])

  const submit = async () => {
    setBusy(true)
    setError(null)
    setWrong(false)
    try {
      const r = await checkin.answer(answer)
      if (!r.correct) {
        setWrong(true)
        setAnswer('')
        return
      }
      // Une entrée de carnet déjà écrite ce mois se rattache au check-in (E2-US07).
      const existing = await journal.readMonth(currentMonth().slice(0, 7)).catch(() => null)
      setDone(await checkin.complete(r.checkin_token, existing?.entry.id))
    } catch (err) {
      setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>{t(lang, done.already_this_month ? 'checkin.game.doneAgain' : 'checkin.game.done')}</Title>
        {done.badge_earned && <Body>{t(lang, 'checkin.game.badge', { badge: t(lang, badgeKey(done.badge_earned)) })}</Body>}
        <Body>{t(lang, 'checkin.streak', { current: done.streak, longest: done.streak })}</Body>
        <Body>{t(lang, 'checkin.game.journalOffer')}</Body>
        <Button title={t(lang, 'checkin.game.journalYes')} onPress={() => router.replace('/journal/entry')} />
        <Button title={t(lang, 'checkin.game.journalLater')} secondary onPress={() => router.back()} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Title>{t(lang, 'checkin.game.title')}</Title>
      {game ? (
        <>
          <Body>{game.prompt}</Body>
          {game.choices && (
            <View style={styles.row}>
              {game.choices.map((c) => (
                <Pressable key={c} onPress={() => setAnswer(answer ? `${answer} ${c}` : c)} style={styles.chip}>
                  <Text style={styles.chipText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Field label={t(lang, 'checkin.game.answer')} value={answer} onChangeText={setAnswer} autoCapitalize="none" />
          {wrong && <Body>{t(lang, 'checkin.game.wrong')}</Body>}
          <ErrorText>{error}</ErrorText>
          <Button title={t(lang, 'checkin.game.submit')} onPress={() => void submit()} busy={busy} disabled={!answer.trim()} />
        </>
      ) : (
        <ErrorText>{error}</ErrorText>
      )}
      <Button title={t(lang, 'common.cancel')} secondary onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.brand },
  chipText: { color: colors.brand },
})
