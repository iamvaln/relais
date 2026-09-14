// Paramètres sécurité (E6-US02, E6-US03) : TOTP avec codes de récupération, mot de passe,
// biométrie (activer après coup avec le PIN, désactiver).
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, Text } from 'react-native'
import { activateTotp, changePassword, disableTotp, PinInvalidError, PinLockedError, setupTotp } from '@relais/app-core'
import { t } from '@/i18n'
import { api } from '@/lib/api'
import { biometricsAvailable, device } from '@/lib/device'
import { messageFor } from '@/lib/errors'
import { biometricsStatusLine } from '@/lib/security'
import { sessionStore, useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, PinField, Screen, Title } from '@/ui'

export default function Security() {
  const lang = useSession((s) => s.language)
  const user = useSession((s) => s.user)
  const [uri, setUri] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bio, setBio] = useState<{ available: boolean; enabled: boolean } | null>(null)
  const [bioPin, setBioPin] = useState('')

  const refreshBio = async () => setBio({ available: await biometricsAvailable(), enabled: await device.hasBiometrics() })
  useEffect(() => {
    void refreshBio()
  }, [])

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (err) {
      if (err instanceof PinLockedError) setError(t(lang, 'unlock.locked', { seconds: err.retryInSeconds }))
      else if (err instanceof PinInvalidError) setError(err.retryInSeconds > 0 ? t(lang, 'unlock.locked', { seconds: err.retryInSeconds }) : t(lang, 'unlock.invalid'))
      else setError(messageFor(err, lang, { AUTH_2FA_INVALID: 'twoFactor.invalid' }))
    }
  }

  const refresh = async () => sessionStore.getState().setUser(await api.auth.me())

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Title>{t(lang, 'security.title')}</Title>
        <Body>
          {t(lang, 'security.totp')} : {user?.totp_enabled ? t(lang, 'security.totpOn') : t(lang, 'security.totpOff')}
        </Body>
        {recoveryCodes ? (
          <>
            <Body>{t(lang, 'security.recoveryTitle')}</Body>
            <Body>{t(lang, 'security.recoveryBody')}</Body>
            {recoveryCodes.map((c) => (
              <Text key={c} selectable={false} style={{ fontFamily: 'monospace', fontSize: 18 }}>
                {c}
              </Text>
            ))}
            <Button title={t(lang, 'security.recoveryNoted')} onPress={() => setRecoveryCodes(null)} />
          </>
        ) : uri ? (
          <>
            <Body>{t(lang, 'security.totpScan')}</Body>
            <Text selectable style={{ fontSize: 12 }}>
              {uri}
            </Text>
            <Field label={t(lang, 'security.totpCode')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
            <Button
              title={t(lang, 'security.totpEnable')}
              disabled={code.length !== 6}
              onPress={() =>
                void run(async () => {
                  setRecoveryCodes(await activateTotp(api, code))
                  setUri(null)
                  setCode('')
                  await refresh()
                })
              }
            />
          </>
        ) : user?.totp_enabled ? (
          <>
            <Field label={t(lang, 'security.totpCode')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
            <Button
              title={t(lang, 'security.totpDisable')}
              secondary
              disabled={code.length !== 6}
              onPress={() =>
                void run(async () => {
                  await disableTotp(api, code)
                  setCode('')
                  await refresh()
                })
              }
            />
          </>
        ) : (
          <Button title={t(lang, 'security.totpEnable')} onPress={() => void run(async () => setUri((await setupTotp(api)).otpauth_uri))} />
        )}

        <Title>{t(lang, 'security.biometrics')}</Title>
        {bio && <Body>{biometricsStatusLine(lang, bio)}</Body>}
        {bio && !bio.enabled && bio.available && (
          <>
            <PinField label={t(lang, 'pin.field')} value={bioPin} onChangeText={setBioPin} />
            <Button
              title={t(lang, 'security.bioEnable')}
              disabled={bioPin.length !== 6}
              onPress={() =>
                void run(async () => {
                  try {
                    await device.enableBiometricsWithPin(bioPin)
                  } finally {
                    setBioPin('')
                  }
                  await refreshBio()
                  setNotice(t(lang, 'security.bioEnabled'))
                })
              }
            />
          </>
        )}
        {bio?.enabled && (
          <Button
            title={t(lang, 'security.bioDisable')}
            secondary
            onPress={() =>
              void run(async () => {
                await device.disableBiometrics()
                await refreshBio()
                setNotice(t(lang, 'security.bioDisabled'))
              })
            }
          />
        )}

        <Title>{t(lang, 'security.password')}</Title>
        <Field label={t(lang, 'security.currentPassword')} value={current} onChangeText={setCurrent} secureTextEntry />
        <Field label={t(lang, 'security.newPassword')} value={next} onChangeText={setNext} secureTextEntry />
        <Button
          title={t(lang, 'security.password')}
          disabled={!current || !next}
          onPress={() =>
            void run(async () => {
              await changePassword(api, { currentPassword: current, newPassword: next })
              setCurrent('')
              setNext('')
              setNotice(t(lang, 'security.passwordChanged'))
            })
          }
        />
        <ErrorText>{error}</ErrorText>
        {notice && <Body>{notice}</Body>}
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  )
}
