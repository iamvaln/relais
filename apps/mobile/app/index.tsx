import { useQuery } from '@tanstack/react-query'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { t } from '@/i18n'
import { api } from '@/lib/api'

interface Health {
  status: string
  services: Record<string, string>
  uptime: number
}

export default function HealthScreen() {
  const lang = 'fr'
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/health') })

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.brand}>{t(lang, 'app.name')}</Text>
        <Text style={styles.tagline}>{t(lang, 'app.tagline')}</Text>
        <Text style={styles.title}>{t(lang, 'health.title')}</Text>
        {health.isPending && <Text style={styles.body}>{t(lang, 'health.loading')}</Text>}
        {health.isError && <Text style={styles.error}>{t(lang, 'health.offline')}</Text>}
        {health.data && (
          <View>
            <Text style={styles.body}>{t(lang, 'health.apiStatus', { status: health.data.status })}</Text>
            {Object.entries(health.data.services).map(([name, status]) => (
              <Text key={name} style={styles.body}>
                {name} : {status}
              </Text>
            ))}
          </View>
        )}
        <Pressable onPress={() => void health.refetch()} style={styles.button}>
          <Text style={styles.buttonText}>{t(lang, 'common.retry')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { gap: 8 },
  brand: { fontSize: 32, fontWeight: '700' },
  tagline: { fontSize: 16, opacity: 0.7, marginBottom: 24 },
  title: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16 },
  error: { fontSize: 16, color: '#b00020' },
  button: { marginTop: 16, alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8, backgroundColor: '#1b4332' },
  buttonText: { color: 'white', fontWeight: '600' },
})
