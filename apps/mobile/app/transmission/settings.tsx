// Schéma N-of-M (E3-US01) et délais (E3-US05) : cohérence expliquée, PIN pour enregistrer.
// Le schéma n'est modifiable que hors activation ; les délais, toujours.
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { CheckinWeeks, SilenceMonths } from '@relais/app-core'
import { t } from '@/i18n'
import { checkinOccasions, schemaSentence } from '@/lib/transmission'
import { useSession } from '@/state/session'
import { openTransmission, refreshTransmission, useTransmission } from '@/state/transmission'
import { Body, Button, Screen, Title, colors } from '@/ui'
import { PinConfirm } from '@/ui/pin-confirm'

const MONTHS: SilenceMonths[] = [1, 3, 6]
const WEEKS: CheckinWeeks[] = [1, 2, 4]

function Chip({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

export default function TransmissionSettings() {
  const lang = useSession((s) => s.language)
  const { config, contacts } = useTransmission()
  const m = Math.max(contacts.length, 2)
  const [n, setN] = useState(2)
  const [months, setMonths] = useState<SilenceMonths>(3)
  const [weeks, setWeeks] = useState<CheckinWeeks>(4)
  const [askPin, setAskPin] = useState(false)

  useEffect(() => {
    if (!config) return
    setN(Math.min(config.schema.n, m))
    setMonths(config.silence_duration_months as SilenceMonths)
    setWeeks(config.checkin_frequency_weeks as CheckinWeeks)
  }, [config, m])

  const editable = (config?.status ?? 'inactive') === 'inactive'

  if (askPin) {
    return (
      <PinConfirm
        title={t(lang, 'transmission.pinTitle')}
        body={t(lang, 'transmission.pinBody')}
        confirmLabel={t(lang, 'contact.save')}
        onConfirm={async () => {
          const { tx } = await openTransmission()
          if (editable) await tx.setSchema({ n, m })
          await tx.setConfig({ silence_duration_months: months, checkin_frequency_weeks: weeks })
          await refreshTransmission()
          router.back()
        }}
        onCancel={() => setAskPin(false)}
      />
    )
  }

  return (
    <Screen>
      <Title>{t(lang, 'transmission.settings')}</Title>
      <Body>{t(lang, 'transmission.schema.n')}</Body>
      <View style={styles.row}>
        {Array.from({ length: m - 1 }, (_, i) => i + 2).map((k) => (
          <Chip key={k} label={String(k)} active={n === k} disabled={!editable} onPress={() => setN(k)} />
        ))}
      </View>
      <Body>{schemaSentence(lang, n, m)}</Body>
      <Body>{t(lang, 'transmission.schema.min')}</Body>

      <Body>{t(lang, 'transmission.silence')}</Body>
      <View style={styles.row}>
        {MONTHS.map((k) => (
          <Chip key={k} label={t(lang, `transmission.months.${k}`)} active={months === k} onPress={() => setMonths(k)} />
        ))}
      </View>
      <Body>{t(lang, 'transmission.frequency')}</Body>
      <View style={styles.row}>
        {WEEKS.map((k) => (
          <Chip key={k} label={t(lang, `transmission.weeks.${k}`)} active={weeks === k} onPress={() => setWeeks(k)} />
        ))}
      </View>
      <Body>{t(lang, 'transmission.coherence', { occasions: checkinOccasions(months, weeks), months })}</Body>

      <Button title={t(lang, 'contact.save')} onPress={() => setAskPin(true)} />
      <Button title={t(lang, 'common.cancel')} secondary onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.brand },
  chipActive: { backgroundColor: colors.brand },
  chipDisabled: { opacity: 0.4 },
  chipText: { color: colors.brand },
  chipTextActive: { color: 'white' },
})
