// L'owner est vivant : il annule lui-même une transmission déclenchée
// (décision du 12/09/2026), sous PIN. Ouvert depuis l'écran transmission, le
// push « Ta transmission est déclenchée » ou le lien des emails.
import { router } from 'expo-router'
import { useState } from 'react'
import { t } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { openTransmission, refreshTransmission } from '@/state/transmission'
import { Body, Button, ErrorText, Screen, Title } from '@/ui'
import { PinConfirm } from '@/ui/pin-confirm'

export default function CancelTriggered() {
  const lang = useSession((s) => s.language)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) {
    return (
      <Screen>
        <Title>{t(lang, 'transmission.cancelTitle')}</Title>
        <Body>{t(lang, 'transmission.cancelled')}</Body>
        <Button title={t(lang, 'common.back')} onPress={() => router.replace('/transmission')} />
      </Screen>
    )
  }
  if (error) {
    return (
      <Screen>
        <Title>{t(lang, 'transmission.cancelTitle')}</Title>
        <ErrorText>{error}</ErrorText>
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
      </Screen>
    )
  }
  return (
    <PinConfirm
      title={t(lang, 'transmission.cancelTitle')}
      body={t(lang, 'transmission.cancelBody')}
      confirmLabel={t(lang, 'transmission.cancelTriggered')}
      onConfirm={async () => {
        try {
          const { tx } = await openTransmission()
          await tx.cancelTriggered()
          await refreshTransmission()
          setDone(true)
        } catch (err) {
          setError(messageFor(err, lang))
        }
      }}
      onCancel={() => router.back()}
    />
  )
}
