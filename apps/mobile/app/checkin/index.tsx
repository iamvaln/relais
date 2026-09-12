// Check-in (E4-US01, E4-US05) : statut, série, badges, historique, rappels push.
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView } from 'react-native'
import type { CheckinLogEntry, CheckinStatus, CheckinStreak } from '@relais/app-core'
import { t } from '@/i18n'
import { badgeKey, checkinLine } from '@/lib/checkin'
import { messageFor } from '@/lib/errors'
import { enablePush, ONESIGNAL_APP_ID, pushEnabled } from '@/lib/push'
import { checkin } from '@/state/checkin'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Screen, Title } from '@/ui'

export default function CheckinHome() {
  const lang = useSession((s) => s.language)
  const [status, setStatus] = useState<CheckinStatus | null>(null)
  const [streak, setStreak] = useState<CheckinStreak | null>(null)
  const [history, setHistory] = useState<CheckinLogEntry[]>([])
  const [push, setPush] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const s = await checkin.status()
          setStatus(s)
          if (s.transmission_status === 'active' || s.transmission_status === 'paused') {
            const [st, h] = await Promise.all([checkin.streak(), checkin.history()])
            setStreak(st)
            setHistory(h)
          }
          setPush(await pushEnabled())
        } catch (err) {
          setError(messageFor(err, lang))
        }
      })()
    }, [lang]),
  )

  const active = status?.transmission_status === 'active' || status?.transmission_status === 'paused'

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Title>{t(lang, 'checkin.title')}</Title>
        {status && <Body>{checkinLine(lang, status)}</Body>}
        <Body>{t(lang, 'checkin.intro')}</Body>
        {active && <Button title={status?.checked_in_this_month ? t(lang, 'checkin.playAgain') : t(lang, 'checkin.play')} onPress={() => router.push('/checkin/game')} />}
        {!active && <Button title={t(lang, 'transmission.title')} secondary onPress={() => router.push('/transmission')} />}
        {status && status.relance_count > 0 && <Body>{t(lang, 'checkin.relances', { count: status.relance_count })}</Body>}

        {streak && <Body>{t(lang, 'checkin.streak', { current: streak.current, longest: streak.longest })}</Body>}
        {streak && (
          <>
            <Body>{t(lang, 'checkin.badges')}</Body>
            {streak.badges.length === 0 ? <Body>{t(lang, 'checkin.noBadges')}</Body> : streak.badges.map((b) => <Body key={b}>{`★ ${t(lang, badgeKey(b))}`}</Body>)}
          </>
        )}

        {active && (
          <>
            <Body>{t(lang, 'checkin.history')}</Body>
            {history.length === 0 && <Body>{t(lang, 'checkin.noHistory')}</Body>}
            {history.map((h) => (
              <Body key={h.id}>{t(lang, 'checkin.historyItem', { month: h.month.slice(0, 7), attempts: h.attempts, streak: h.streak })}</Body>
            ))}
          </>
        )}

        {ONESIGNAL_APP_ID !== '' && push === false && (
          <>
            <Body>{t(lang, 'push.hint')}</Body>
            <Button title={t(lang, 'push.enable')} secondary onPress={() => void enablePush().then(setPush)} />
          </>
        )}
        {push === true && <Body>{t(lang, 'push.enabled')}</Body>}
        <ErrorText>{error}</ErrorText>
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  )
}
