// Apparence : système / clair / sombre — même forme que le sélecteur de langue.
import { THEME_PREFERENCES } from '@relais/admin-core'
import { useApp } from './app-state'

export function ThemeToggle() {
  const { theme, setTheme, t } = useApp()
  return (
    <span className="lang" role="group" aria-label={t('theme.label')} data-testid="theme-toggle">
      {THEME_PREFERENCES.map((p) => (
        <button key={p} type="button" className={p === theme ? 'active' : ''} onClick={() => setTheme(p)} aria-pressed={p === theme} title={t(`theme.${p}`)}>
          {t(`theme.${p}.short`)}
        </button>
      ))}
    </span>
  )
}
