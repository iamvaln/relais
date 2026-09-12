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

/** GET /admin/health : la sonde publique, plus les jobs et trois compteurs (BO-06). */
export interface HealthView {
  status: string
  services: Record<string, ServiceStatus>
  uptime: number
  jobs: { enabled: boolean }
  counts: { users: number; transmissions_open: number; escrows_active: number }
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

// --- BO-07 Facturation -----------------------------------------------------------

export type SubscriptionStatus = 'active' | 'grace' | 'expired' | 'cancelled'

export interface SubscriptionsFilter {
  search?: string | undefined
  plan?: UserPlan | '' | undefined
  status?: SubscriptionStatus | '' | undefined
  page?: number | undefined
  limit?: number | undefined
}

export interface SubscriptionView {
  id: string
  user_id: string
  user_email: string
  full_name: string
  plan: string
  status: string
  started_at: string
  expires_at: string | null
  grace_until: string | null
  cancelled_at: string | null
  price_fcfa: number | null
  currency: string
  auto_renew: boolean
  extended_count: number
  last_extended_by: string | null
  last_extended_at: string | null
  extension_reason: string | null
}

export interface PlanChange {
  plan: UserPlan
  /** Montant encaissé (Mobile Money, hors app) ; défaut billing.premium_price_fcfa. */
  amount_fcfa?: number
  provider_ref?: string
  reason: string
}

export interface BillingOverview {
  price_fcfa: number
  active_premium: number
  in_grace: number
  mrr_fcfa: number
  arr_fcfa: number
  renewals_this_month: number
  churns_this_month: number
  revenue_this_month_fcfa: number
  revenue_total_fcfa: number
}

export interface CsvExport {
  filename: string
  csv: string
}

// --- BO-02 Tickets ---------------------------------------------------------------

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'urgent' | 'high' | 'normal' | 'low'
export type TicketCategory = 'account_locked' | 'otp_issue' | 'transmission' | 'subscription' | 'rgpd' | 'other'

export interface TicketsFilter {
  status?: TicketStatus | '' | undefined
  priority?: TicketPriority | '' | undefined
  category?: TicketCategory | '' | undefined
  page?: number | undefined
  limit?: number | undefined
}

export interface TicketView {
  id: string
  subject: string
  body: string
  category: string
  status: string
  priority: string
  resolution_note: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  user_id: string | null
  user_email: string
  assigned_to: string | null
}

export interface TicketUpdate {
  status?: TicketStatus
  priority?: TicketPriority
  assigned_to?: string | null
  resolution_note?: string
}

// --- BO-06 Monitoring ------------------------------------------------------------

export interface AuditFilter {
  action?: string | undefined
  admin_id?: string | undefined
  target_id?: string | undefined
  from?: string | undefined
  to?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

export interface AuditView {
  id: string
  admin_id: string | null
  user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  value_before: unknown
  value_after: unknown
  reason: string | null
  ip_hash: string
  created_at: string
}
