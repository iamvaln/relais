// Apparence : comme le téléphone, clair ou sombre. La préférence est mémorisée sur le device.
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@/i18n'
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme'
import { useSession } from '@/state/session'
import { Body, Button, Screen, Title, themeStore, useStyles, useTheme, type Palette } from '@/ui'

export default function Appearance() {
  const lang = useSession((s) => s.language)
  const { preference, scheme } = useTheme()
  const styles = useStyles(makeStyles)
  const choose = (p: ThemePreference) => void themeStore.getState().setPreference(p)

  return (
    <Screen>
      <Title>{t(lang, 'appearance.title')}</Title>
      <Body>{t(lang, 'appearance.body')}</Body>
      <View style={styles.row} accessibilityRole="radiogroup">
        {THEME_PREFERENCES.map((p) => (
          <Pressable
            key={p}
            onPress={() => choose(p)}
            accessibilityRole="radio"
            accessibilityState={{ selected: preference === p }}
            style={[styles.chip, preference === p && styles.chipActive]}
          >
            <Text style={[styles.chipText, preference === p && styles.chipTextActive]}>{t(lang, `appearance.${p}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Body>{t(lang, 'appearance.current', { scheme: t(lang, `appearance.scheme.${scheme}`) })}</Body>
      <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
    </Screen>
  )
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.brand },
    chipActive: { backgroundColor: colors.brand },
    chipText: { color: colors.brand, fontSize: 15 },
    chipTextActive: { color: colors.onBrand },
  })
