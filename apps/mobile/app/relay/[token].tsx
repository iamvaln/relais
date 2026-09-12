// Le parcours du contact dans l'app (E5-US01 à US05, F4), ouvert par le deep
// link relais://relay/:token. Rien n'est stocké en clair : le coffre est
// reconstitué en mémoire à chaque ouverture ; seule la progression « Fait »
// reste sur le téléphone (décision du 12/09/2026).
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { type ContactAccess, type RelayLinkView, type RelayPhase, RelayFlow, phaseOf } from '@relais/app-core'
import { t, type MessageKey } from '@/i18n'
import { api } from '@/lib/api'
import { secureStorage } from '@/lib/device'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { Body, Button, ErrorText, Field, Screen, Title, colors } from '@/ui'

const flow = new RelayFlow({ api, storage: secureStorage })

export default function Relay() {
  const lang = useSession((s) => s.language)
  const { token } = useLocalSearchParams<{ token: string }>()
  const [link, setLink] = useState<RelayLinkView | null>(null)
  const [phase, setPhase] = useState<RelayPhase | 'invalid' | 'blocked' | null>(null)
  const [answers, setAnswers] = useState<[string, string, string]>(['', '', ''])
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)
  const [waiting, setWaiting] = useState<{ answered: number; needed: number } | null>(null)
  const [access, setAccess] = useState<ContactAccess | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [l, s] = await Promise.all([flow.link(token), flow.status(token)])
      setLink(l)
      setWaiting({ answered: s.answered, needed: s.needed })
      const p = phaseOf(l, s)
      setPhase(p)
      if (p === 'access') {
        setAccess(await flow.unlock(token))
        setDone(await flow.progress(token))
      }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'RELAY_TOKEN_INVALID') setPhase('invalid')
      else if (code === 'RELAY_CONTACT_BLOCKED') setPhase('blocked')
      else setError(messageFor(err, lang))
    }
  }, [token, lang])

  useEffect(() => {
    void load()
  }, [load])

  const owner = link?.owner_name ?? ''
  const qText = (i: number) => (link ? (lang === 'fr' ? link.questions[i]!.text_fr : link.questions[i]!.text_en) : '')

  const submit = async () => {
    if (!link) return
    setBusy(true)
    setError(null)
    try {
      const r = await flow.answer(token, link, answers)
      if (!r.ok) {
        setAttemptsLeft(r.attempts_left)
        setAnswers(['', '', ''])
        return
      }
      await load()
    } catch (err) {
      if ((err as { code?: string }).code === 'RELAY_TOKEN_EXHAUSTED') setPhase('blocked')
      else setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (id: string) => {
    if (!access) return
    const isDone = done.includes(id)
    await flow.markDone(token, id, !isDone, access.access_expires_at)
    setDone(await flow.progress(token))
  }

  const finish = () => {
    Alert.alert(t(lang, 'relay.finishTitle'), t(lang, 'relay.finishBody'), [
      { text: t(lang, 'common.cancel'), style: 'cancel' },
      {
        text: t(lang, 'relay.finish'),
        style: 'destructive',
        onPress: () => {
          void flow.confirm(token).then(() => setPhase('done'), (err) => setError(messageFor(err, lang)))
        },
      },
    ])
  }

  if (phase === null) {
    return (
      <Screen>
        <Body>…</Body>
        <ErrorText>{error}</ErrorText>
      </Screen>
    )
  }

  if (phase === 'invalid' || phase === 'blocked') {
    return (
      <Screen>
        <Title>Relais</Title>
        <Body>{t(lang, phase === 'invalid' ? 'relay.expired' : 'relay.blocked')}</Body>
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.replace('/')} />
      </Screen>
    )
  }

  if (phase === 'done') {
    return (
      <Screen>
        <Title>{t(lang, 'relay.finished.title')}</Title>
        <Body>{t(lang, 'relay.finished.body')}</Body>
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.replace('/')} />
      </Screen>
    )
  }

  if (phase === 'questions') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.list}>
          <Title>{t(lang, 'relay.title', { owner })}</Title>
          <Body>{t(lang, 'relay.intro', { owner })}</Body>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.list}>
              <Body>{qText(i)}</Body>
              <Field
                label={t(lang, 'relay.answer')}
                value={answers[i]}
                onChangeText={(v) => {
                  const next = [...answers] as [string, string, string]
                  next[i] = v
                  setAnswers(next)
                }}
                autoCapitalize="none"
              />
            </View>
          ))}
          {attemptsLeft !== null && <Body>{t(lang, 'relay.wrong', { left: attemptsLeft, owner })}</Body>}
          <ErrorText>{error}</ErrorText>
          <Button title={t(lang, 'relay.submit')} onPress={() => void submit()} busy={busy} disabled={answers.some((a) => !a.trim())} />
        </ScrollView>
      </Screen>
    )
  }

  if (phase === 'waiting' || !access) {
    return (
      <Screen>
        <Title>{t(lang, 'relay.waiting.title', { owner })}</Title>
        <Body>{t(lang, 'relay.waiting.body', { owner, missing: Math.max((waiting?.needed ?? 0) - (waiting?.answered ?? 0), 0), answered: waiting?.answered ?? 0, needed: waiting?.needed ?? 0 })}</Body>
        <ErrorText>{error}</ErrorText>
        <Button title={t(lang, 'relay.refresh')} secondary onPress={() => void load()} />
      </Screen>
    )
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.list}>
        <Title>{t(lang, 'relay.access.title', { owner })}</Title>
        <Body>{t(lang, 'relay.access.body', { date: new Date(access.access_expires_at).toLocaleDateString() })}</Body>
        {access.message?.message_personnel ? (
          <>
            <Text style={styles.section}>{t(lang, 'relay.message')}</Text>
            <Body>{access.message.message_personnel}</Body>
          </>
        ) : null}
        {access.checklist.map((section) => (
          <View key={section.urgency} style={styles.list}>
            <Text style={styles.section}>{t(lang, `relay.section.${section.urgency}` as MessageKey)}</Text>
            {section.items.length === 0 && <Body>{t(lang, 'relay.empty')}</Body>}
            {section.items.map((item) => {
              const isDone = done.includes(item.id)
              return (
                <View key={item.id} style={[styles.item, isDone && styles.itemDone]}>
                  <Text style={styles.itemTitle}>{item.service_name}</Text>
                  {item.login ? <Body>{`${t(lang, 'vault.form.login')} : ${item.login}`}</Body> : null}
                  {item.password ? (
                    <Pressable
                      onPress={() => {
                        const next = new Set(revealed)
                        if (next.has(item.id)) next.delete(item.id)
                        else next.add(item.id)
                        setRevealed(next)
                      }}
                    >
                      <Body>{`${t(lang, 'vault.form.password')} : ${revealed.has(item.id) ? item.password : '••••••••'}  (${t(lang, revealed.has(item.id) ? 'relay.hide' : 'relay.reveal')})`}</Body>
                    </Pressable>
                  ) : null}
                  {item.instructions ? <Body>{item.instructions}</Body> : null}
                  {item.notes ? <Body>{item.notes}</Body> : null}
                  <Button title={isDone ? t(lang, 'relay.done') : t(lang, 'relay.todo')} secondary={!isDone} onPress={() => void toggle(item.id)} />
                </View>
              )
            })}
          </View>
        ))}
        {access.journal && access.journal.length > 0 && (
          <>
            <Text style={styles.section}>{t(lang, 'relay.journal', { owner })}</Text>
            {access.journal.map((e) => (
              <Body key={e.entry_month}>{`${e.entry_month.slice(0, 7)} — ${e.texte}`}</Body>
            ))}
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button title={t(lang, 'relay.finish')} disabled={done.length === 0} onPress={finish} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  section: { fontSize: 18, fontWeight: '600', color: colors.ink, marginTop: 8 },
  item: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.field, gap: 4 },
  itemDone: { opacity: 0.55 },
  itemTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
})
