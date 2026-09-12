import { ApiError } from '@relais/api-client'
import { homeModule } from '@relais/admin-core'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useApp } from '../app-state'

export function LoginScreen() {
  const { admin, ready, login, t, lostNotice, lang, setLang } = useApp()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (ready && admin) return <Navigate to={`/${homeModule(admin.role) ?? ''}`} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const a = await login({ email: email.trim(), password, code: code.trim() })
      navigate(`/${homeModule(a.role) ?? ''}`, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_INVALID_CREDENTIALS') setError(t('login.error.credentials'))
      else if (err instanceof ApiError && err.code === 'AUTH_ACCOUNT_LOCKED') setError(t('login.error.locked'))
      else if (err instanceof ApiError && err.code === 'RATE_LIMITED') setError(t('login.error.rate'))
      else setError(t('login.error.generic', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form onSubmit={(e) => void submit(e)} className="card">
        <h1>{t('login.title')}</h1>
        {lostNotice && <p className="error">{t('session.expired')}</p>}
        <label>
          {t('login.email')}
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {t('login.password')}
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label>
          {t('login.code')}
          <input inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || code.length !== 6}>
          {t('login.submit')}
        </button>
        <span className="lang" role="group" aria-label="Langue">
          {(['fr', 'en'] as const).map((l) => (
            <button key={l} type="button" className={l === lang ? 'active' : ''} onClick={() => setLang(l)} aria-pressed={l === lang}>
              {l.toUpperCase()}
            </button>
          ))}
        </span>
      </form>
    </div>
  )
}
