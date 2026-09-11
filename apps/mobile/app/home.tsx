// Tableau de bord (E2-US06) : fiches par catégorie, dernière sauvegarde,
// transmission et check-in (lots 4 et 5), tutoriel du premier compte (E1-US06).
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import type { VaultCategory } from '@relais/app-core'
import { t } from '@/i18n'
import { secureStorage } from '@/lib/device'
import { keyStore } from '@/state/keystore'
import { useSession } from '@/state/session'
import { openVault, useSyncError, useVaultVersion } from '@/state/vault'
import { Body, Button, ErrorText, Screen, Title } from '@/ui'

const TUTORIAL_KEY = 'relais.tutorial_seen'

export default function Home() {
  const lang = useSession((s) => s.language)
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  const version = useVaultVersion()
  const syncError = useSyncError()
  const [counts, setCounts] = useState<Record<VaultCategory, number> | null>(null)
  const [lastSync, setLastSync] = useState<string | null | undefined>(undefined)
  const [tutorial, setTutorial] = useState(false)

  useEffect(() => {
    void (async () => {
      const { vault, sync } = await openVault()
      const c = await vault.counts()
      setCounts(c)
      const total = c.accounts + c.messages + c.finances
      setTutorial(total === 0 && (await secureStorage.get(TUTORIAL_KEY)) === null)
      try {
        const status = await sync.status()
        const dates = Object.values(status)
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .map((s) => s.synced_at)
          .sort()
        setLastSync(dates.at(-1) ?? null)
      } catch {
        setLastSync(null)
      }
    })()
  }, [version])

  const dismissTutorial = async () => {
    await secureStorage.set(TUTORIAL_KEY, '1')
    setTutorial(false)
  }

  return (
    <Screen>
      <Title>{t(lang, 'home.title')}</Title>
      <Body>{user?.full_name ?? ''}</Body>
      {counts && <Body>{t(lang, 'dashboard.counts', counts)}</Body>}
      {lastSync !== undefined && <Body>{lastSync ? t(lang, 'dashboard.lastSync', { date: new Date(lastSync).toLocaleString() }) : t(lang, 'dashboard.neverSynced')}</Body>}
      <ErrorText>{syncError ? t(lang, 'vault.sync.error', { category: t(lang, `vault.category.${syncError}`) }) : null}</ErrorText>
      <Body>{t(lang, 'dashboard.transmission')}</Body>
      <Body>{t(lang, 'dashboard.checkin')}</Body>
      {tutorial ? (
        <>
          <Title>{t(lang, 'tutorial.title')}</Title>
          <Body>{t(lang, 'tutorial.body')}</Body>
          <Button
            title={t(lang, 'tutorial.start')}
            onPress={() => {
              void dismissTutorial()
              router.push({ pathname: '/vault/form', params: { tutorial: '1' } })
            }}
          />
          <Button title={t(lang, 'tutorial.later')} secondary onPress={() => void dismissTutorial()} />
        </>
      ) : (
        <Button title={t(lang, 'dashboard.openVault')} onPress={() => router.push('/vault')} />
      )}
      <Button title={t(lang, 'home.security')} secondary onPress={() => router.push('/settings/security')} />
      <Button
        title={t(lang, 'home.lock')}
        secondary
        onPress={() => {
          keyStore.getState().lock()
          router.replace('/unlock')
        }}
      />
      <Button title={t(lang, 'home.signOut')} secondary onPress={() => void signOut().then(() => router.replace('/'))} />
    </Screen>
  )
}
