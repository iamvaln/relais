// Récapitulatif et activation (E3-US06) : contacts, rôles, schéma, délais ;
// les problèmes sont dits avant le PIN ; les parts sont calculées sur le device.
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { checkActivation, ROLE_SLOTS } from '@relais/app-core'
import { t } from '@/i18n'
import { activationProblemKey, checkinOccasions, schemaSentence } from '@/lib/transmission'
import { useSession } from '@/state/session'
import { openTransmission, refreshTransmission, useTransmission } from '@/state/transmission'
import { Body, Button, ErrorText, Screen, Title } from '@/ui'
import { PinConfirm } from '@/ui/pin-confirm'

export default function Activate() {
  const lang = useSession((s) => s.language)
  const { config, contacts } = useTransmission()
  const [askPin, setAskPin] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const m = contacts.length
  const n = Math.min(config?.schema.n ?? 2, Math.max(m, 2))
  const check = checkActivation(contacts, { n, m })
  const problems = check.problems.filter((p) => p.code !== 'schema_m_mismatch')

  if (askPin) {
    return (
      <PinConfirm
        title={t(lang, 'transmission.pinTitle')}
        body={t(lang, 'transmission.recap.body')}
        confirmLabel={t(lang, 'transmission.recap.confirm')}
        onConfirm={async () => {
          const { tx } = await openTransmission()
          await tx.activate()
          await refreshTransmission()
          setAskPin(false)
          setNotice(t(lang, 'transmission.activated'))
        }}
        onCancel={() => setAskPin(false)}
      />
    )
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Title>{t(lang, 'transmission.recap.title')}</Title>
        <Body>{t(lang, 'transmission.recap.body')}</Body>
        {contacts.map((c) => (
          <Body key={c.id}>{`${c.name} — ${ROLE_SLOTS.filter((s) => c.roles[s]).map((s) => t(lang, `role.${s}`)).join(', ')}`}</Body>
        ))}
        <Body>{schemaSentence(lang, n, Math.max(m, 2))}</Body>
        {config && (
          <Body>
            {t(lang, 'transmission.coherence', { occasions: checkinOccasions(config.silence_duration_months, config.checkin_frequency_weeks), months: config.silence_duration_months })}
          </Body>
        )}
        {problems.map((p, i) => (
          <ErrorText key={i}>
            {t(lang, activationProblemKey(p), {
              ...(p.code === 'role_holders_below_n' ? { role: t(lang, `role.${p.slot}`), holders: p.holders, n } : {}),
              ...(p.code === 'missing_answers' ? { name: contacts.find((c) => c.id === p.contactId)?.name ?? '?' } : {}),
            })}
          </ErrorText>
        ))}
        {notice ? (
          <>
            <Body>{notice}</Body>
            <Button title={t(lang, 'common.continue')} onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Button title={t(lang, 'transmission.recap.confirm')} disabled={problems.length > 0} onPress={() => setAskPin(true)} />
            <Button title={t(lang, 'common.cancel')} secondary onPress={() => router.back()} />
          </>
        )}
      </ScrollView>
    </Screen>
  )
}
