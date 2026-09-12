// Miroirs des vues rendues par l'API /admin (apps/api/src/api/admin/*). Rien
// ici ne contient de donnée chiffrée : le back office ne voit que des
// métadonnées (Back Office Specs §1, contrainte zero-knowledge).

export interface AdminView {
  id: string
  email: string
  full_name: string
  role: string
}

export interface AdminLoginResult {
  access_token: string
  expires_in: number
  admin: AdminView
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

export type UserPlan = 'free' | 'premium'
export type UserStatus = 'pending_verification' | 'active' | 'suspended' | 'deleted'
export type TransmissionStatus = 'inactive' | 'active' | 'paused' | 'triggered' | 'completed'

export interface UserRowView {
  id: string
  full_name: string
  email: string
  phone: string | null
  language: string
  plan: string
  account_status: string
  transmission_status: string | null
  last_checkin_at: string | null
  created_at: string
}

export interface UserDetailView extends UserRowView {
  totp_enabled: boolean
  login_fail_count: number
  login_locked_until: string | null
  deleted_at: string | null
  subscription: { plan: string; status: string; expires_at: string | null } | null
  transmission: Record<string, unknown> | null
  journal_entries: number
  checkins: number
  sessions: number
}

export interface UsersFilter {
  search?: string | undefined
  plan?: UserPlan | '' | undefined
  status?: UserStatus | '' | undefined
  transmission?: TransmissionStatus | '' | undefined
  created_from?: string | undefined
  created_to?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface DashboardKpis {
  users_total: number
  users_active_30d: number
  premium_active: number
  transmissions_triggered_this_month: number
  transmissions_completed_this_month: number
  transmissions_completed_total: number
  transmissions_active: number
  checkin_rate: number | null
  revenue_this_month_fcfa: number
  tickets_open: number
}

export interface DashboardAlert {
  type: string
  severity: AlertSeverity
  count: number
  [k: string]: unknown
}

export interface DashboardView {
  generated_at: string
  kpis: DashboardKpis
  alerts: DashboardAlert[]
}

export type ServiceStatus = 'ok' | 'down' | 'unconfigured'

export interface HealthView {
  status: string
  services: Record<string, ServiceStatus>
  [k: string]: unknown
}
