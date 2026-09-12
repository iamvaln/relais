// Carnet de vie (E2-US07) : le mois en cours, les réponses passées relues
// déchiffrées, la rétrospective de l'année.
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import type { EntryClear, JournalEntry } from '@relais/app-core'
import { t, type MessageKey } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { journal } from '@/state/checkin'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Screen, Title, colors } from '@/ui'

export default function JournalHome() {
  const lang = useSession((s) => s.language)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [answered, setAnswered] = useState<boolean | null>(null)
  const [open, setOpen] = useState<{ entry: JournalEntry; clear: EntryClear } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    void (async () => {
      try {
        const [q, list] = await Promise.all([journal.question('essential'), journal.entries()])
        setAnswered(q.answered)
        setEntries(list)
      } catch (err) {
        setError(messageFor(err, lang))
      }
    })()
  }, [lang])
  useFocusEffect(reload)

  const read = async (id: string) => {
    try {
      setOpen(await journal.read(id))
    } catch (err) {
      setError(messageFor(err, lang))
    }
  }

  const remove = (id: string) => {
    Alert.alert(t(lang, 'journal.deleteTitle'), t(lang, 'journal.deleteBody'), [
      { text: t(lang, 'common.cancel'), style: 'cancel' },
      {
        text: t(lang, 'journal.delete'),
        style: 'destructive',
        onPress: () => {
          void journal.remove(id).then(() => {
            setOpen(null)
            reload()
          }, (err) => setError(messageFor(err, lang)))
        },
      },
    ])
  }

  const year = new Date().getUTCFullYear()

  if (open) {
    return (
      <Screen>
        <Title>{open.entry.month.slice(0, 7)}</Title>
        <Body>{t(lang, `journal.mode.${open.clear.mode}` as MessageKey)}</Body>
        <Body>{open.clear.texte}</Body>
        <Button title={t(lang, 'journal.delete')} secondary onPress={() => remove(open.entry.id)} />
        <Button title={t(lang, 'common.back')} secondary onPress={() => setOpen(null)} />
      </Screen>
    )
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Title>{t(lang, 'journal.title')}</Title>
        <Body>{t(lang, 'journal.intro')}</Body>
        <Body>{t(lang, 'journal.thisMonth')}</Body>
        {answered !== null && <Body>{t(lang, answered ? 'journal.answered' : 'journal.notAnswered')}</Body>}
        <Button title={t(lang, 'journal.write')} onPress={() => router.push('/journal/entry')} />

        <Body>{t(lang, 'journal.entries')}</Body>
        {entries.length === 0 && <Body>{t(lang, 'journal.noEntries')}</Body>}
        {entries.map((e) => (
          <Pressable key={e.id} onPress={() => void read(e.id)} style={styles.item}>
            <Text style={styles.itemTitle}>
              {t(lang, 'journal.entryMeta', { month: e.month.slice(0, 7), mode: t(lang, `journal.mode.${e.mode}` as MessageKey), words: e.word_count_approx ?? 0 })}
            </Text>
          </Pressable>
        ))}
        <Button title={t(lang, 'journal.wrapped', { year })} secondary onPress={() => router.push({ pathname: '/journal/wrapped', params: { year: String(year) } })} />
        <ErrorText>{error}</ErrorText>
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.field },
  itemTitle: { fontSize: 16, color: colors.ink },
})
