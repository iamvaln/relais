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

// --- BO-03 Transmissions ------------------------------------------------------

export type TransmissionRunStatus = 'triggered' | 'in_progress' | 'completed' | 'cancelled' | 'expired'

export interface TransmissionsFilter {
  status?: TransmissionRunStatus | '' | undefined
  page?: number | undefined
  limit?: number | undefined
}

export interface TransmissionRowView {
  id: string
  status: string
  triggered_at: string
  schema: { n: number; m: number }
  contacts_notified: number
  contacts_confirmed: number
  unlocked: { k1: boolean; k2: boolean; k3: boolean }
  escrow_active: boolean
  escrow_expires_at: string
  escrow_ttl_seconds: number
  escrow_extended_count: number
  completed_at: string | null
  cancelled_at: string | null
}

export interface TransmissionContactView {
  id: string
  status: string
  fail_count: number
  blocked: boolean
  roles: { k1: boolean; k2: boolean; k3: boolean }
  notified_at: string
  answered_at: string | null
  confirmed_at: string | null
}

export interface AuditRowView {
  id: string
  action: string
  admin_id: string | null
  reason: string | null
  created_at: string
}

export interface TransmissionDetailView extends TransmissionRowView {
  user_id: string
  cancellation_reason: string | null
  contacts: TransmissionContactView[]
  audit: AuditRowView[]
}

// --- BO-04 Questions ------------------------------------------------------------

export const QUESTION_CATEGORIES = [
  'childhood', 'places', 'events', 'people', 'habits', 'shared_memory', 'other',
  'month_memory', 'relations', 'work', 'gratitude', 'introspection', 'legacy', 'lightness',
] as const
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number]
export type QuestionUsage = 'secret_question' | 'journal' | 'both'
export type QuestionStatus = 'active' | 'archived' | 'review'
export type QuestionMode = 'essential' | 'reflective' | 'all'

export interface QuestionsFilter {
  usage_type?: QuestionUsage | '' | undefined
  status?: QuestionStatus | '' | undefined
  category?: QuestionCategory | '' | undefined
}

export interface QuestionInput {
  text_fr: string
  text_en: string
  category: QuestionCategory
  usage_type: QuestionUsage
  reliability_score: number
  risk_notes?: string
  cycle_month?: number
  mode_target?: QuestionMode
}

export interface QuestionUpdate extends Partial<QuestionInput> {
  status?: 'active' | 'review'
}

export interface QuestionView {
  id: string
  text_fr: string
  text_en: string
  category: string
  usage_type: string
  reliability_score: number
  status: string
  risk_notes: string | null
  cycle_month: number | null
  mode_target: string | null
  usage_count: number
  failure_rate: number
  block_rate: number
  created_at: string
  updated_at: string
}

// --- BO-05 Configuration ---------------------------------------------------------

export interface ConfigView {
  key: string
  value: unknown
  config_type: string
  category: string
  description: string
  updated_by: string | null
  updated_at: string
}
