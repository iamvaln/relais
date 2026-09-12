// Rétrospective annuelle (DEC-32) : calculée sur le device, déposée chiffrée et signée.
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import type { WrappedStats, WrappedView } from '@relais/app-core'
import { t } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { journal } from '@/state/checkin'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Screen, Title } from '@/ui'

export default function Wrapped() {
  const lang = useSession((s) => s.language)
  const params = useLocalSearchParams<{ year?: string }>()
  const year = Number(params.year ?? new Date().getUTCFullYear())
  const [data, setData] = useState<{ view: WrappedView; stats: WrappedStats } | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    journal.wrapped(year).then(setData, (err) => setError(messageFor(err, lang)))
  }, [year, lang])

  const build = async () => {
    setBusy(true)
    setError(null)
    try {
      setData(await journal.buildWrapped(year))
    } catch (err) {
      const e = err as { code?: string; details?: { current?: number } }
      if (e.code === 'WRAPPED_INSUFFICIENT_ENTRIES') setError(t(lang, 'wrapped.insufficient', { current: e.details?.current ?? 0 }))
      else setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{t(lang, 'wrapped.title', { year })}</Title>
      <Body>{t(lang, 'wrapped.intro')}</Body>
      {data ? (
        <>
          <Body>{t(lang, 'wrapped.entries', { entries: data.stats.entries })}</Body>
          <Body>{t(lang, 'wrapped.words', { words: data.stats.words })}</Body>
          <Body>{t(lang, 'wrapped.modes', data.stats.modes)}</Body>
          {data.stats.longest && <Body>{t(lang, 'wrapped.longest', { month: data.stats.longest.month.slice(0, 7), words: data.stats.longest.words })}</Body>}
          <Body>{t(lang, 'wrapped.months', { months: data.stats.months.map((m) => m.slice(5, 7)).join(' · ') })}</Body>
          {data.view.exported_at ? (
            <Body>{t(lang, 'wrapped.exported', { date: new Date(data.view.exported_at).toLocaleDateString() })}</Body>
          ) : (
            <Button title={t(lang, 'wrapped.export')} secondary onPress={() => void journal.markExported(year).then((view) => setData({ ...data, view }), (err) => setError(messageFor(err, lang)))} />
          )}
          <Button title={t(lang, 'wrapped.rebuild')} secondary onPress={() => void build()} busy={busy} />
        </>
      ) : (
        <>
          {data === null && <Body>{t(lang, 'wrapped.none', { year })}</Body>}
          <Button title={t(lang, 'wrapped.build')} onPress={() => void build()} busy={busy} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
    </Screen>
  )
}
