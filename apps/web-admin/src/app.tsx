// Routes : /login public ; le reste derrière la session, un chemin par module.
// Le menu ne montre que les modules du rôle (décision du 12/09/2026) ; un
// module hors rôle redirige vers l'accueil du rôle.
import { homeModule, modulesFor, type Module } from '@relais/admin-core'
import { createBrowserRouter, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from './app-state'
import { DashboardScreen } from './screens/dashboard'
import { BillingScreen } from './screens/billing'
import { ConfigScreen } from './screens/config'
import { LoginScreen } from './screens/login'
import { MonitoringScreen } from './screens/monitoring'
import { QuestionsScreen } from './screens/questions'
import { TicketScreen } from './screens/ticket'
import { TicketsScreen } from './screens/tickets'
import { TransmissionScreen } from './screens/transmission'
import { TransmissionsScreen } from './screens/transmissions'
import { UserScreen } from './screens/user'
import { UsersScreen } from './screens/users'

const NAV_KEY = { dashboard: 'nav.dashboard', users: 'nav.users', transmissions: 'nav.transmissions', questions: 'nav.questions', config: 'nav.config', monitoring: 'nav.monitoring', billing: 'nav.billing', tickets: 'nav.tickets' } as const

function LangToggle() {
  const { lang, setLang } = useApp()
  return (
    <span className="lang" role="group" aria-label="Langue">
      {(['fr', 'en'] as const).map((l) => (
        <button key={l} type="button" className={l === lang ? 'active' : ''} onClick={() => setLang(l)} aria-pressed={l === lang}>
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  )
}

function Shell() {
  const { admin, ready, t, logout } = useApp()
  const location = useLocation()
  if (!ready) return <p className="main muted">{t('common.loading')}</p>
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  const modules = modulesFor(admin.role)
  return (
    <div className="shell">
      <nav className="side" aria-label="Modules">
        <div className="brand">RELAIS</div>
        {modules.map((m) => (
          <NavLink key={m} to={`/${m}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t(NAV_KEY[m])}
          </NavLink>
        ))}
        <div className="foot">
          <span>
            {admin.full_name} · {admin.role}
          </span>
          <LangToggle />
          <button type="button" className="secondary" onClick={() => void logout()}>
            {t('nav.logout')}
          </button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

function Home() {
  const { admin } = useApp()
  const home = admin ? homeModule(admin.role) : null
  return <Navigate to={home ? `/${home}` : '/login'} replace />
}

/** Un module du rôle, sinon retour à l'accueil du rôle. */
function Guarded({ module, children }: { module: Module; children: React.ReactNode }) {
  const { admin } = useApp()
  if (!admin || !modulesFor(admin.role).includes(module)) return <Home />
  return <>{children}</>
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'dashboard', element: <Guarded module="dashboard"><DashboardScreen /></Guarded> },
      { path: 'users', element: <Guarded module="users"><UsersScreen /></Guarded> },
      { path: 'users/:id', element: <Guarded module="users"><UserScreen /></Guarded> },
      { path: 'transmissions', element: <Guarded module="transmissions"><TransmissionsScreen /></Guarded> },
      { path: 'transmissions/:id', element: <Guarded module="transmissions"><TransmissionScreen /></Guarded> },
      { path: 'questions', element: <Guarded module="questions"><QuestionsScreen /></Guarded> },
      { path: 'config', element: <Guarded module="config"><ConfigScreen /></Guarded> },
      { path: 'monitoring', element: <Guarded module="monitoring"><MonitoringScreen /></Guarded> },
      { path: 'billing', element: <Guarded module="billing"><BillingScreen /></Guarded> },
      { path: 'tickets', element: <Guarded module="tickets"><TicketsScreen /></Guarded> },
      { path: 'tickets/:id', element: <Guarded module="tickets"><TicketScreen /></Guarded> },
      { path: '*', element: <Home /> },
    ],
  },
])
