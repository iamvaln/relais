// Confirmation par PIN avant une action sensible (E3-US05 à US07, E6-US04) :
// le PIN est vérifié sur le device (DEC-26), puis l'action part avec son step-up.

import { useState } from 'react'
import { PinInvalidError, PinLockedError } from '@relais/app-core'
import { wipe } from '@relais/crypto-core'
import { t } from '@/i18n'
import { device } from '@/lib/device'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, PinField, Screen, Title } from './index'

export function PinConfirm(props: { title: string; body: string; confirmLabel: string; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const lang = useSession((s) => s.language)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      wipe(await device.unlockWithPin(pin))
      await props.onConfirm()
    } catch (err) {
      if (err instanceof PinLockedError) setError(t(lang, 'unlock.locked', { seconds: err.retryInSeconds }))
      else if (err instanceof PinInvalidError) setError(err.retryInSeconds > 0 ? t(lang, 'unlock.locked', { seconds: err.retryInSeconds }) : t(lang, 'unlock.invalid'))
      else setError(messageFor(err, lang))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{props.title}</Title>
      <Body>{props.body}</Body>
      <PinField label={t(lang, 'pin.field')} value={pin} onChangeText={setPin} />
      <ErrorText>{error}</ErrorText>
      <Button title={props.confirmLabel} onPress={() => void confirm()} busy={busy} disabled={pin.length !== 6} />
      <Button title={t(lang, 'common.cancel')} secondary onPress={props.onCancel} />
    </Screen>
  )
}
