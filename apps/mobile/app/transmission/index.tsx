// Transmission (E3) : contacts, schéma, délais, activation, pause, et le
// parcours guidé de modification (décision du 12/09/2026 : désactiver →
// modifier → réactiver, puisque contacts et schéma sont figés une fois actif).
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { ROLE_SLOTS } from '@relais/app-core'
import { t } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { checkinOccasions, schemaSentence, transmissionStatusLine } from '@/lib/transmission'
import { useSession } from '@/state/session'
import { openTransmission, refreshTransmission, useTransmission } from '@/state/transmission'
import { Body, Button, ErrorText, Screen, Title, colors } from '@/ui'
import { PinConfirm } from '@/ui/pin-confirm'

export default function TransmissionHome() {
  const lang = useSession((s) => s.language)
  const { config, contacts } = useTransmission()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [modifying, setModifying] = useState(false)

  useFocusEffect(
    useCallback(() => {
      refreshTransmission().catch((err) => setError(messageFor(err, lang)))
    }, [lang]),
  )

  const run = async (fn: () => Promise<void>, done?: string) => {
    setError(null)
    setNotice(null)
    try {
      await fn()
      await refreshTransmission()
      if (done) setNotice(done)
    } catch (err) {
      setError(messageFor(err, lang))
    }
  }

  if (modifying) {
    return (
      <PinConfirm
        title={t(lang, 'transmission.modifyTitle')}
        body={t(lang, 'transmission.modifyBody')}
        confirmLabel={t(lang, 'transmission.deactivate')}
        onConfirm={async () => {
          const { tx } = await openTransmission()
          await tx.deactivate()
          setModifying(false)
          await run(async () => undefined, t(lang, 'transmission.deactivated'))
        }}
        onCancel={() => setModifying(false)}
      />
    )
  }

  const status = config?.status ?? 'inactive'
  const editable = status === 'inactive'
  const m = contacts.length
  const n = Math.min(config?.schema.n ?? 2, Math.max(m, 2))

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.list}>
        <Title>{t(lang, 'transmission.title')}</Title>
        <Body>{transmissionStatusLine(lang, { status, pause_until: config?.pause_until ?? null, contacts: m })}</Body>
        {m === 0 && <Body>{t(lang, 'transmission.intro')}</Body>}

        <Text style={styles.section}>{t(lang, 'transmission.contacts')}</Text>
        {m === 0 && <Body>{t(lang, 'transmission.noContacts')}</Body>}
        {contacts.map((c) => (
          <Pressable key={c.id} onPress={() => router.push({ pathname: '/transmission/[id]', params: { id: c.id } })} style={styles.item}>
            <Text style={styles.itemTitle}>{c.name}</Text>
            <Text style={styles.itemMeta}>{ROLE_SLOTS.filter((s) => c.roles[s]).map((s) => t(lang, `role.${s}`)).join(' · ')}</Text>
          </Pressable>
        ))}
        {editable && m < 5 && <Button title={t(lang, 'transmission.addContact')} secondary onPress={() => router.push('/transmission/contact')} />}

        {m >= 2 && <Body>{schemaSentence(lang, n, m)}</Body>}
        {config && (
          <Body>
            {t(lang, 'transmission.coherence', {
              occasions: checkinOccasions(config.silence_duration_months, config.checkin_frequency_weeks),
              months: config.silence_duration_months,
            })}
          </Body>
        )}
        <Button title={t(lang, 'transmission.settings')} secondary onPress={() => router.push('/transmission/settings')} />

        <ErrorText>{error}</ErrorText>
        {notice && <Body>{notice}</Body>}

        {editable && m >= 2 && <Button title={t(lang, 'transmission.activate')} onPress={() => router.push('/transmission/activate')} />}
        {(status === 'active' || status === 'paused') && <Button title={t(lang, 'transmission.modify')} secondary onPress={() => setModifying(true)} />}
        {status === 'active' && <Button title={t(lang, 'transmission.pause')} secondary onPress={() => router.push('/transmission/pause')} />}
        {status === 'paused' && (
          <Button
            title={t(lang, 'transmission.resume')}
            onPress={() =>
              void run(async () => {
                const { tx } = await openTransmission()
                await tx.resume()
              })
            }
          />
        )}
        <Button title={t(lang, 'transmission.about')} secondary onPress={() => router.push('/transmission/about')} />
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  section: { fontSize: 18, fontWeight: '600', color: colors.ink, marginTop: 8 },
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.field },
  itemTitle: { fontSize: 16, color: colors.ink, fontWeight: '600' },
  itemMeta: { fontSize: 13, color: colors.muted },
})
