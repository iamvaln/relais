// Fiche en lecture (E2-US02, E2-US04) : mot de passe masqué, date de dernière
// modification, suppression confirmée et définitive.
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import type { VaultItem } from '@relais/app-core'
import { t } from '@/i18n'
import { useSession } from '@/state/session'
import { openVault, useVaultVersion } from '@/state/vault'
import { Body, Button, Screen, Title } from '@/ui'

export default function VaultDetail() {
  const lang = useSession((s) => s.language)
  const { id } = useLocalSearchParams<{ id: string }>()
  const version = useVaultVersion()
  const [item, setItem] = useState<VaultItem | null>(null)
  const [reveal, setReveal] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void openVault().then(({ vault }) => vault.get(id)).then(setItem)
  }, [id, version])

  const remove = () => {
    Alert.alert(t(lang, 'vault.detail.deleteTitle'), t(lang, 'vault.detail.deleteBody'), [
      { text: t(lang, 'common.cancel'), style: 'cancel' },
      {
        text: t(lang, 'vault.detail.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { vault } = await openVault()
            const category = item?.category
            await vault.remove(id)
            const counts = await vault.counts()
            if (category && counts[category] === 0) setNotice(t(lang, 'vault.detail.lastOfCategory'))
            router.back()
          })()
        },
      },
    ])
  }

  if (!item) return null
  return (
    <Screen>
      <Title>{item.service_name}</Title>
      <Body>
        {t(lang, `vault.category.${item.category}`)} · {t(lang, `vault.urgency.${item.urgency}`)}
      </Body>
      {item.login ? <Body>{`${t(lang, 'vault.form.login')} : ${item.login}`}</Body> : null}
      {item.password ? <Body>{`${t(lang, 'vault.form.password')} : ${reveal ? item.password : '••••••••'}`}</Body> : null}
      {item.password ? <Button title={reveal ? t(lang, 'vault.detail.hide') : t(lang, 'vault.detail.show')} secondary onPress={() => setReveal(!reveal)} /> : null}
      {item.instructions ? <Body>{`${t(lang, 'vault.form.instructions')} : ${item.instructions}`}</Body> : null}
      {item.notes ? <Body>{`${t(lang, 'vault.form.notes')} : ${item.notes}`}</Body> : null}
      <Body>{t(lang, 'vault.detail.updatedAt', { date: new Date(item.updated_at).toLocaleString() })}</Body>
      {notice && <Body>{notice}</Body>}
      <Button title={t(lang, 'vault.detail.edit')} onPress={() => router.push({ pathname: '/vault/form', params: { id } })} />
      <Button title={t(lang, 'vault.detail.delete')} secondary onPress={remove} />
      <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
    </Screen>
  )
}
