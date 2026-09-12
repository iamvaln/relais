// Contact en lecture : rôles, questions, aperçu anonymisé du message (E2-US05),
// vérification annuelle (Techniques §7.2), retrait (PIN).
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { type Answers, type Contact, ROLE_SLOTS, type SecretQuestion } from '@relais/app-core'
import { t } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { openTransmission, refreshTransmission, useTransmission } from '@/state/transmission'
import { Body, Button, ErrorText, Field, Screen, Title } from '@/ui'
import { PinConfirm } from '@/ui/pin-confirm'

export default function ContactDetail() {
  const lang = useSession((s) => s.language)
  const { config, version } = useTransmission()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [contact, setContact] = useState<Contact | null>(null)
  const [questions, setQuestions] = useState<SecretQuestion[]>([])
  const [answers, setAnswers] = useState<[string, string, string]>(['', '', ''])
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const { tx, store } = await openTransmission()
        setContact(await store.get(id))
        setQuestions(await tx.questions())
      } catch (err) {
        setError(messageFor(err, lang))
      }
    })()
  }, [id, lang, version])

  const verify = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { tx } = await openTransmission()
      const { verified } = await tx.verifyContact(id, answers as Answers)
      setNotice(t(lang, verified ? 'contact.verifyOk' : 'contact.verifyKo'))
      if (verified) {
        setAnswers(['', '', ''])
        await refreshTransmission()
      }
    } catch (err) {
      setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const confirmRemove = () => {
    Alert.alert(t(lang, 'contact.removeTitle'), t(lang, 'contact.removeBody'), [
      { text: t(lang, 'common.cancel'), style: 'cancel' },
      { text: t(lang, 'contact.remove'), style: 'destructive', onPress: () => setRemoving(true) },
    ])
  }

  if (removing) {
    return (
      <PinConfirm
        title={t(lang, 'transmission.pinTitle')}
        body={t(lang, 'contact.removeBody')}
        confirmLabel={t(lang, 'contact.remove')}
        onConfirm={async () => {
          const { tx } = await openTransmission()
          await tx.removeContact(id)
          await refreshTransmission()
          router.back()
        }}
        onCancel={() => setRemoving(false)}
      />
    )
  }

  if (!contact) return null
  const server = config?.contacts.find((c) => c.id === contact.serverId)
  const editable = (config?.status ?? 'inactive') === 'inactive'
  const verifiable = Boolean(server?.verify_token)
  const label = (qid: string) => {
    const q = questions.find((x) => x.id === qid)
    return q ? (lang === 'fr' ? q.text_fr : q.text_en) : '…'
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Title>{contact.name}</Title>
        <Body>{[contact.email, contact.phone].filter(Boolean).join(' · ')}</Body>
        <Body>{ROLE_SLOTS.filter((s) => contact.roles[s]).map((s) => `${t(lang, `role.${s}`)} — ${t(lang, `role.${s}.desc`)}`).join('\n')}</Body>
        {contact.questionIds.map((qid, i) => (
          <Body key={qid}>{`${t(lang, 'contact.question', { i: i + 1 })} : ${label(qid)}`}</Body>
        ))}
        <Body>{contact.answers ? t(lang, 'contact.answersKnown') : t(lang, 'contact.answersMissing')}</Body>
        <Body>{contact.message ? t(lang, 'contact.messageSaved', { chars: contact.message.length }) : t(lang, 'contact.noMessage')}</Body>

        {verifiable && (
          <>
            <Title>{t(lang, 'contact.verify')}</Title>
            <Body>{server?.verify_last_checked_at ? t(lang, 'contact.lastVerified', { date: new Date(server.verify_last_checked_at).toLocaleDateString() }) : t(lang, 'contact.neverVerified')}</Body>
            <Body>{t(lang, 'contact.verifyBody')}</Body>
            {[0, 1, 2].map((i) => (
              <Field
                key={i}
                label={label(contact.questionIds[i]!)}
                value={answers[i]}
                onChangeText={(v) => {
                  const next = [...answers] as [string, string, string]
                  next[i] = v
                  setAnswers(next)
                }}
                autoCapitalize="none"
              />
            ))}
            <Button title={t(lang, 'contact.verify')} onPress={() => void verify()} busy={busy} disabled={answers.some((a) => !a.trim())} />
          </>
        )}

        <ErrorText>{error}</ErrorText>
        {notice && <Body>{notice}</Body>}
        {editable && <Button title={t(lang, 'vault.detail.edit')} onPress={() => router.push({ pathname: '/transmission/contact', params: { id } })} />}
        {editable && <Button title={t(lang, 'contact.remove')} secondary onPress={confirmRemove} />}
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  )
}
