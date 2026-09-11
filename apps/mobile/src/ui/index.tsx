// Composants minces et sobres — le ton de Relais : chaleureux, sans jargon.

import type { PropsWithChildren } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export const colors = { ink: '#1b1b1b', muted: '#6b6b6b', brand: '#1b4332', danger: '#b00020', field: '#f2f2f2' }

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  )
}

export function Title({ children }: PropsWithChildren) {
  return <Text style={styles.title}>{children}</Text>
}

export function Body({ children }: PropsWithChildren) {
  return <Text style={styles.body}>{children}</Text>
}

export function ErrorText({ children }: { children: string | null | undefined }) {
  return children ? <Text style={styles.error}>{children}</Text> : null
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...rest } = props
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.field} placeholderTextColor={colors.muted} {...rest} />
    </View>
  )
}

export function PinField(props: { label: string; value: string; onChangeText: (v: string) => void }) {
  return <Field label={props.label} value={props.value} onChangeText={(v) => props.onChangeText(v.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} />
}

export function Button(props: { title: string; onPress: () => void; busy?: boolean; secondary?: boolean; disabled?: boolean }) {
  const disabled = props.disabled || props.busy
  return (
    <Pressable onPress={props.onPress} disabled={disabled} style={[styles.button, props.secondary && styles.buttonSecondary, disabled && styles.buttonDisabled]}>
      {props.busy ? <ActivityIndicator color={props.secondary ? colors.brand : 'white'} /> : <Text style={[styles.buttonText, props.secondary && styles.buttonTextSecondary]}>{props.title}</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  body: { fontSize: 16, color: colors.ink, lineHeight: 22 },
  error: { fontSize: 15, color: colors.danger },
  fieldWrap: { gap: 4 },
  label: { fontSize: 13, color: colors.muted },
  field: { backgroundColor: colors.field, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.ink },
  button: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8, backgroundColor: colors.brand, alignItems: 'center' },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.brand },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
  buttonTextSecondary: { color: colors.brand },
})
