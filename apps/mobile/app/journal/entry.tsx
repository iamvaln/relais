// La réponse du mois (E2-US07) : mode, question du serveur, texte chiffré
// sous K2 et signé ; réécrire le mois remplace l'entrée.
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { type JournalMode, type MonthQuestion, currentMonth } from '@relais/app-core'
import { t, type MessageKey } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { journal } from '@/state/checkin'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title, colors } from '@/ui'

const MODES: JournalMode[] = ['essential', 'reflective', 'free']

export default function JournalEntry() {
  const lang = useSession((s) => s.language)
  const [mode, setMode] = useState<JournalMode>('essential')
  const [question, setQuestion] = useState<MonthQuestion | null>(null)
  const [texte, setTexte] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    journal.question(mode).then(setQuestion, (err) => setError(messageFor(err, lang)))
  }, [mode, lang])

  useEffect(() => {
    void journal.readMonth(currentMonth().slice(0, 7)).then((r) => {
      if (r) {
        setTexte(r.clear.texte)
        setMode(r.clear.mode)
      }
    }, () => undefined)
  }, [])

  const save = async () => {
    if (!texte.trim()) return setError(t(lang, 'journal.textRequired'))
    setBusy(true)
    setError(null)
    try {
      await journal.save({ mode, questionId: question?.question?.id ?? null, texte })
      setNotice(t(lang, 'journal.saved'))
    } catch (err) {
      setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const qText = question?.question ? (lang === 'fr' ? question.question.text_fr : question.question.text_en) : null

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Title>{t(lang, 'journal.thisMonth')}</Title>
        <Body>{t(lang, 'journal.mode')}</Body>
        <View style={styles.row}>
          {MODES.map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.chip, mode === m && styles.chipActive]}>
              <Text style={[styles.chipText, mode === m && styles.chipTextActive]}>{t(lang, `journal.mode.${m}` as MessageKey)}</Text>
            </Pressable>
          ))}
        </View>
        <Body>{t(lang, `journal.mode.${mode}.desc` as MessageKey)}</Body>
        <Body>{qText ?? t(lang, 'journal.noQuestion')}</Body>
        <Field label={t(lang, 'journal.text')} value={texte} onChangeText={setTexte} multiline />
        <ErrorText>{error}</ErrorText>
        {notice ? (
          <>
            <Body>{notice}</Body>
            <Button title={t(lang, 'common.continue')} onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Button title={t(lang, 'journal.save')} onPress={() => void save()} busy={busy} />
            <Button title={t(lang, 'common.cancel')} secondary onPress={() => router.back()} />
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.brand },
  chipActive: { backgroundColor: colors.brand },
  chipText: { color: colors.brand },
  chipTextActive: { color: 'white' },
})
