// Fiche : création et modification (E2-US01, E2-US03). Les données financières
// demandent le PIN avant l'enregistrement — ressaisie locale, décision du 11/09/2026.
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { PinInvalidError, PinLockedError, URGENCIES, VAULT_CATEGORIES, type Urgency, type VaultCategory, type VaultItemInput } from '@relais/app-core'
import { wipe } from '@relais/crypto-core'
import { t } from '@/i18n'
import { device } from '@/lib/device'
import { messageFor } from '@/lib/errors'
import { useSession } from '@/state/session'
import { openVault } from '@/state/vault'
import { Body, Button, ErrorText, Field, PinField, Screen, Title, colors } from '@/ui'

const EXAMPLE: Partial<VaultItemInput> = { service_name: 'Orange Money', login: '+237 6 99 00 00 00', instructions: 'Appelle le 8008, demande la clôture au nom de …, ils demandent la CNI.' }

export default function VaultForm() {
  const lang = useSession((s) => s.language)
  const params = useLocalSearchParams<{ id?: string; category?: VaultCategory; tutorial?: string }>()
  const editing = Boolean(params.id)
  const [form, setForm] = useState<VaultItemInput>({
    category: params.category ?? 'accounts',
    service_name: '',
    urgency: 'within_30_days',
    ...(params.tutorial ? EXAMPLE : {}),
  })
  const [pin, setPin] = useState('')
  const [askPin, setAskPin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!params.id) return
    void openVault().then(({ vault }) => vault.get(params.id!)).then((item) => {
      if (item) setForm(item)
    })
  }, [params.id])

  const save = async () => {
    if (!form.service_name.trim()) return setError(t(lang, 'vault.form.serviceRequired'))
    if (form.category === 'finances' && !askPin) return setAskPin(true)
    setBusy(true)
    setError(null)
    try {
      if (form.category === 'finances') {
        const seed = await device.unlockWithPin(pin)
        wipe(seed)
      }
      const { vault } = await openVault()
      if (params.id) await vault.update(params.id, form)
      else await vault.add(form)
      router.back()
    } catch (err) {
      if (err instanceof PinLockedError) setError(t(lang, 'unlock.locked', { seconds: err.retryInSeconds }))
      else if (err instanceof PinInvalidError) setError(err.retryInSeconds > 0 ? t(lang, 'unlock.locked', { seconds: err.retryInSeconds }) : t(lang, 'unlock.invalid'))
      else setError(messageFor(err, lang))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const set = (patch: Partial<VaultItemInput>) => setForm({ ...form, ...patch })

  if (askPin) {
    return (
      <Screen>
        <Title>{t(lang, 'vault.form.pinTitle')}</Title>
        <Body>{t(lang, 'vault.form.pinBody')}</Body>
        <PinField label={t(lang, 'pin.field')} value={pin} onChangeText={setPin} />
        <ErrorText>{error}</ErrorText>
        <Button title={t(lang, 'vault.form.save')} onPress={() => void save()} busy={busy} disabled={pin.length !== 6} />
        <Button title={t(lang, 'common.cancel')} secondary onPress={() => setAskPin(false)} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Title>{editing ? t(lang, 'vault.form.editTitle') : t(lang, 'vault.form.newTitle')}</Title>
      {!editing && (
        <View style={styles.row}>
          {VAULT_CATEGORIES.map((c) => (
            <Pressable key={c} onPress={() => set({ category: c })} style={[styles.chip, form.category === c && styles.chipActive]}>
              <Text style={[styles.chipText, form.category === c && styles.chipTextActive]}>{t(lang, `vault.category.${c}`)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Field label={t(lang, 'vault.form.service')} value={form.service_name} onChangeText={(v) => set({ service_name: v })} />
      <Field label={t(lang, 'vault.form.login')} value={form.login ?? ''} onChangeText={(v) => set({ login: v })} autoCapitalize="none" />
      <Field label={t(lang, 'vault.form.password')} value={form.password ?? ''} onChangeText={(v) => set({ password: v })} secureTextEntry />
      <Field label={t(lang, 'vault.form.instructions')} value={form.instructions ?? ''} onChangeText={(v) => set({ instructions: v })} placeholder={t(lang, 'vault.form.instructionsHint')} multiline />
      <Field label={t(lang, 'vault.form.notes')} value={form.notes ?? ''} onChangeText={(v) => set({ notes: v })} multiline />
      <Body>{t(lang, 'vault.form.urgency')}</Body>
      <View style={styles.row}>
        {URGENCIES.map((u: Urgency) => (
          <Pressable key={u} onPress={() => set({ urgency: u })} style={[styles.chip, form.urgency === u && styles.chipActive]}>
            <Text style={[styles.chipText, form.urgency === u && styles.chipTextActive]}>{t(lang, `vault.urgency.${u}`)}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title={t(lang, 'vault.form.save')} onPress={() => void save()} busy={busy} />
      <Button title={t(lang, 'common.cancel')} secondary onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.brand },
  chipActive: { backgroundColor: colors.brand },
  chipText: { color: colors.brand },
  chipTextActive: { color: 'white' },
})
