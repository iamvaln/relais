// Fiche contact (E3-US01 à US03, E2-US05) : identité, rôles, trois questions
// de la bibliothèque, réponses (qui restent sur le téléphone), message personnel.
// Modifier un contact déjà chez Relais demande le PIN (E3-US07).
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { type Answers, type ContactInput, type Roles, ROLE_SLOTS, type SecretQuestion } from '@relais/app-core'
import { t, type MessageKey } from '@/i18n'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { openTransmission, useTransmission } from '@/state/transmission'
import { Body, Button, ErrorText, Field, Screen, Title, colors } from '@/ui'
import { PinConfirm } from '@/ui/pin-confirm'

type Form = Omit<ContactInput, 'questionIds' | 'answers'> & { questionIds: [string, string, string]; answers: [string, string, string] }

const EMPTY: Form = { name: '', email: '', phone: null, message: '', roles: { k1: true, k2: false, k3: false }, questionIds: ['', '', ''], answers: ['', '', ''] }

export default function ContactForm() {
  const lang = useSession((s) => s.language)
  const { config } = useTransmission()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const [form, setForm] = useState<Form>(EMPTY)
  const [serverId, setServerId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<SecretQuestion[]>([])
  const [picking, setPicking] = useState<number | null>(null)
  const [askPin, setAskPin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const { tx, store } = await openTransmission()
        setQuestions(await tx.questions())
        if (id) {
          const c = await store.get(id)
          if (c) {
            setForm({ ...c, answers: c.answers ?? ['', '', ''] })
            setServerId(c.serverId)
          }
        }
      } catch (err) {
        setError(messageFor(err, lang))
      }
    })()
  }, [id, lang])

  const validate = (): MessageKey | null => {
    if (!form.name.trim()) return 'contact.nameRequired'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'contact.emailRequired'
    if (!ROLE_SLOTS.some((s) => form.roles[s])) return 'contact.rolesRequired'
    if (form.questionIds.some((q) => !q) || new Set(form.questionIds).size !== 3) return 'contact.questionsRequired'
    if (form.answers.some((a) => !a.trim())) return 'contact.answersRequired'
    return null
  }

  const persist = async () => {
    const { tx } = await openTransmission()
    await tx.saveContact({ ...form, answers: form.answers as Answers }, id)
    router.back()
  }

  const save = async () => {
    const problem = validate()
    if (problem) return setError(t(lang, problem))
    if (id && serverId) return setAskPin(true)
    setBusy(true)
    setError(null)
    try {
      await persist()
    } catch (err) {
      setError(messageFor(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
  const setAt = (key: 'questionIds' | 'answers', i: number, value: string) => {
    const next = [...form[key]] as [string, string, string]
    next[i] = value
    set({ [key]: next })
  }
  const label = (q: SecretQuestion) => (lang === 'fr' ? q.text_fr : q.text_en)

  if (config && config.status !== 'inactive') {
    return (
      <Screen>
        <Title>{t(lang, 'contact.editTitle')}</Title>
        <Body>{t(lang, 'contact.locked')}</Body>
        <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
      </Screen>
    )
  }

  if (askPin) {
    return <PinConfirm title={t(lang, 'transmission.pinTitle')} body={t(lang, 'transmission.pinBody')} confirmLabel={t(lang, 'contact.save')} onConfirm={persist} onCancel={() => setAskPin(false)} />
  }

  if (picking !== null) {
    const categories = [...new Set(questions.map((q) => q.category))]
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.list}>
          <Title>{t(lang, 'contact.pickTitle')}</Title>
          <Body>{t(lang, 'contact.questionsHint')}</Body>
          {categories.map((cat) => (
            <View key={cat} style={styles.list}>
              <Text style={styles.section}>{t(lang, `question.category.${cat}` as MessageKey)}</Text>
              {questions
                .filter((q) => q.category === cat)
                .map((q) => (
                  <Pressable
                    key={q.id}
                    disabled={form.questionIds.includes(q.id)}
                    onPress={() => {
                      setAt('questionIds', picking, q.id)
                      setPicking(null)
                    }}
                    style={[styles.item, form.questionIds.includes(q.id) && styles.itemDisabled]}
                  >
                    <Text style={styles.itemTitle}>{label(q)}</Text>
                  </Pressable>
                ))}
            </View>
          ))}
          <Button title={t(lang, 'common.cancel')} secondary onPress={() => setPicking(null)} />
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.list}>
        <Title>{id ? t(lang, 'contact.editTitle') : t(lang, 'contact.newTitle')}</Title>
        <Field label={t(lang, 'contact.name')} value={form.name} onChangeText={(v) => set({ name: v })} />
        <Field label={t(lang, 'contact.email')} value={form.email} onChangeText={(v) => set({ email: v })} autoCapitalize="none" keyboardType="email-address" />
        <Field label={t(lang, 'contact.phone')} value={form.phone ?? ''} onChangeText={(v) => set({ phone: v || null })} keyboardType="phone-pad" />

        <Text style={styles.section}>{t(lang, 'contact.roles')}</Text>
        {ROLE_SLOTS.map((s) => (
          <Pressable key={s} onPress={() => set({ roles: { ...form.roles, [s]: !form.roles[s] } as Roles })} style={[styles.role, form.roles[s] && styles.roleActive]}>
            <Text style={[styles.itemTitle, form.roles[s] && styles.roleTextActive]}>{t(lang, `role.${s}`)}</Text>
            <Text style={[styles.itemMeta, form.roles[s] && styles.roleTextActive]}>{t(lang, `role.${s}.desc`)}</Text>
          </Pressable>
        ))}

        <Text style={styles.section}>{t(lang, 'contact.questions')}</Text>
        <Body>{t(lang, 'contact.questionsHint')}</Body>
        {[0, 1, 2].map((i) => {
          const q = questions.find((x) => x.id === form.questionIds[i])
          return (
            <View key={i} style={styles.list}>
              <Pressable onPress={() => setPicking(i)} style={styles.item}>
                <Text style={styles.itemMeta}>{t(lang, 'contact.question', { i: i + 1 })}</Text>
                <Text style={styles.itemTitle}>{q ? label(q) : t(lang, 'contact.pickQuestion')}</Text>
              </Pressable>
              <Field label={t(lang, 'contact.answer', { i: i + 1 })} value={form.answers[i]} onChangeText={(v) => setAt('answers', i, v)} autoCapitalize="none" />
            </View>
          )
        })}
        <Body>{t(lang, 'contact.answersHint')}</Body>

        <Field label={t(lang, 'contact.message')} value={form.message} onChangeText={(v) => set({ message: v })} placeholder={t(lang, 'contact.messageHint')} multiline />

        <ErrorText>{error}</ErrorText>
        <Button title={t(lang, 'contact.save')} onPress={() => void save()} busy={busy} />
        <Button title={t(lang, 'common.cancel')} secondary onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  section: { fontSize: 18, fontWeight: '600', color: colors.ink, marginTop: 8 },
  item: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.field },
  itemDisabled: { opacity: 0.4 },
  itemTitle: { fontSize: 16, color: colors.ink },
  itemMeta: { fontSize: 13, color: colors.muted },
  role: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.brand },
  roleActive: { backgroundColor: colors.brand },
  roleTextActive: { color: 'white' },
})
