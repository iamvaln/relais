// E1-US02 : 12 mots affichés une seule fois, non sélectionnables, pas de « Passer ».
import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { t } from '@/i18n'
import { useSession } from '@/state/session'
import { Body, Button, Screen, Title, colors } from '@/ui'

export default function Words() {
  const lang = useSession((s) => s.language)
  const flow = useSession((s) => s.onboarding)
  const [noted, setNoted] = useState(false)
  const words = flow?.state.words?.split(' ') ?? []
  if (!flow || words.length !== 12) return null

  return (
    <Screen>
      <Title>{t(lang, 'words.title')}</Title>
      <Body>{t(lang, 'words.body')}</Body>
      <View style={styles.grid}>
        {words.map((w, i) => (
          <Text key={i} selectable={false} style={styles.word}>
            {i + 1}. {w}
          </Text>
        ))}
      </View>
      <View style={styles.row}>
        <Switch value={noted} onValueChange={setNoted} />
        <Body>{t(lang, 'words.noted')}</Body>
      </View>
      <Button
        title={t(lang, 'common.continue')}
        disabled={!noted}
        onPress={() => {
          flow.confirmWordsNoted()
          router.replace('/onboarding/quiz')
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  word: { width: '45%', fontSize: 17, fontWeight: '600', color: colors.ink, backgroundColor: colors.field, padding: 8, borderRadius: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
})
