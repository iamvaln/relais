// Liste du coffre (E2-US02) : filtres catégorie / urgence, recherche, lecture locale.
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { URGENCIES, VAULT_CATEGORIES, type Urgency, type VaultCategory, type VaultItem } from '@relais/app-core'
import { t } from '@/i18n'
import { useSession } from '@/state/session'
import { openVault, useVaultVersion } from '@/state/vault'
import { Body, Button, Field, Screen, Title, colors } from '@/ui'

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

export default function VaultList() {
  const lang = useSession((s) => s.language)
  const params = useLocalSearchParams<{ category?: VaultCategory }>()
  const version = useVaultVersion()
  const [category, setCategory] = useState<VaultCategory | undefined>(params.category)
  const [urgency, setUrgency] = useState<Urgency | undefined>()
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<VaultItem[]>([])

  useEffect(() => {
    void openVault().then(({ vault }) => vault.list({ ...(category ? { category } : {}), ...(urgency ? { urgency } : {}), search }).then(setItems))
  }, [category, urgency, search, version])

  return (
    <Screen>
      <Title>{t(lang, 'vault.title')}</Title>
      <View style={styles.row}>
        <Chip label={t(lang, 'vault.all')} active={!category} onPress={() => setCategory(undefined)} />
        {VAULT_CATEGORIES.map((c) => (
          <Chip key={c} label={t(lang, `vault.category.${c}`)} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>
      <View style={styles.row}>
        {URGENCIES.map((u) => (
          <Chip key={u} label={t(lang, `vault.urgency.${u}`)} active={urgency === u} onPress={() => setUrgency(urgency === u ? undefined : u)} />
        ))}
      </View>
      <Field label={t(lang, 'vault.search')} value={search} onChangeText={setSearch} autoCapitalize="none" />
      {items.length === 0 ? (
        <Body>{t(lang, 'vault.empty')}</Body>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push({ pathname: '/vault/[id]', params: { id: item.id } })} style={styles.item}>
              <Text style={styles.itemTitle}>{item.service_name}</Text>
              <Text style={styles.itemMeta}>
                {t(lang, `vault.category.${item.category}`)} · {t(lang, `vault.urgency.${item.urgency}`)}
              </Text>
            </Pressable>
          )}
        />
      )}
      <Button title={t(lang, 'vault.add')} onPress={() => router.push({ pathname: '/vault/form', params: category ? { category } : {} })} />
      <Button title={t(lang, 'common.back')} secondary onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.brand },
  chipActive: { backgroundColor: colors.brand },
  chipText: { color: colors.brand },
  chipTextActive: { color: 'white' },
  item: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.muted },
  itemTitle: { fontSize: 17, fontWeight: '600', color: colors.ink },
  itemMeta: { fontSize: 13, color: colors.muted },
})
