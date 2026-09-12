import type { DashboardKpis } from '@relais/admin-core'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../app-state'
import { formatDateTime, formatFcfa, formatRate } from '../format'
import { label } from '../i18n'

const KPI_ORDER: (keyof DashboardKpis)[] = [
  'users_total',
  'users_active_30d',
  'premium_active',
  'transmissions_active',
  'transmissions_triggered_this_month',
  'transmissions_completed_this_month',
  'transmissions_completed_total',
  'checkin_rate',
  'revenue_this_month_fcfa',
  'tickets_open',
]

const SEVERITY_CLASS = { critical: 'danger', high: 'danger', medium: 'warn', low: 'info' } as const

export function DashboardScreen() {
  const { client, t, lang } = useApp()
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => client.dashboard(), refetchInterval: 60_000 })
  const health = useQuery({ queryKey: ['health'], queryFn: () => client.health(), refetchInterval: 60_000 })

  const value = (k: keyof DashboardKpis, v: number | null) => {
    if (k === 'checkin_rate') return formatRate(v)
    if (k === 'revenue_this_month_fcfa') return formatFcfa(v ?? 0)
    return v === null ? '—' : String(v)
  }

  return (
    <>
      <h1>{t('dash.title')}</h1>
      {dash.isPending && <p className="muted">{t('common.loading')}</p>}
      {dash.error && <p className="error">{t('common.error', { message: dash.error.message })}</p>}
      {dash.data && (
        <>
          <p className="muted">{t('dash.generated', { at: formatDateTime(dash.data.generated_at, lang) })}</p>
          <div className="grid">
            {KPI_ORDER.map((k) => (
              <div className="kpi" key={k}>
                <div className="value">{value(k, dash.data.kpis[k])}</div>
                <div className="label">{t(`dash.kpi.${k}`)}</div>
              </div>
            ))}
          </div>
          <h2>{t('dash.alerts')}</h2>
          {dash.data.alerts.length === 0 ? (
            <p className="ok">{t('dash.noAlerts')}</p>
          ) : (
            <table>
              <tbody>
                {dash.data.alerts.map((a, i) => (
                  <tr key={`${a.type}-${i}`}>
                    <td>
                      <span className={`badge ${SEVERITY_CLASS[a.severity]}`}>{label(lang, 'severity', a.severity)}</span>
                    </td>
                    <td>{a.type}</td>
                    <td>{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <h2>{t('dash.health')}</h2>
      {health.data && (
        <div className="actions">
          {Object.entries(health.data.services).map(([name, status]) => (
            <span key={name} className={`badge ${status === 'ok' ? 'ok' : status === 'down' ? 'danger' : ''}`}>
              {name} · {label(lang, 'service', status)}
            </span>
          ))}
        </div>
      )}
      {health.error && <p className="error">{t('common.error', { message: health.error.message })}</p>}
    </>
  )
}
