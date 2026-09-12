// Mode Pause (E6-US04) : 1 semaine, 1 mois ou 3 mois, PIN requis.
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { PauseDays } from '@relais/app-core'
import { t } from '@/i18n'
import { useSession } from '@/state/session'
import { openTransmission, refreshTransmission } from '@/state/transmission'
import { Body, Button, Screen, Title, colors } from '@/ui'
import { PinConfirm } from '@/ui/pin-confirm'

const DAYS: PauseDays[] = [7, 30, 90]

export default function Pause() {
  const lang = useSession((s) => s.language)
  const [days, setDays] = useState<PauseDays>(30)
  const [askPin, setAskPin] = useState(false)

  if (askPin) {
    return (
      <PinConfirm
        title={t(lang, 'transmission.pinTitle')}
        body={t(lang, 'transmission.pause.body')}
        confirmLabel={t(lang, 'transmission.pause')}
        onConfirm={async () => {
          const { tx } = await openTransmission()
          await tx.pause(days)
          await refreshTransmission()
          router.back()
        }}
        onCancel={() => setAskPin(false)}
      />
    )
  }

  return (
    <Screen>
      <Title>{t(lang, 'transmission.pause.title')}</Title>
      <Body>{t(lang, 'transmission.pause.body')}</Body>
      <View style={styles.row}>
        {DAYS.map((d) => (
          <Pressable key={d} onPress={() => setDays(d)} style={[styles.chip, days === d && styles.chipActive]}>
            <Text style={[styles.chipText, days === d && styles.chipTextActive]}>{t(lang, `transmission.pause.days.${d}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Button title={t(lang, 'transmission.pause')} onPress={() => setAskPin(true)} />
      <Button title={t(lang, 'common.cancel')} secondary onPress={() => router.back()} />
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
