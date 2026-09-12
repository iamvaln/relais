// Client de l'API /admin : même enveloppe et mêmes erreurs que l'app, mais
// une session différente — jeton bearer 8 h, session Redis révocable, jamais
// de cookie ni de refresh. Un 401 ferme la session côté client.

import { ApiClient, type ApiClientOptions, ApiError, type RequestOptions } from '@relais/api-client'
import type {
  AdminLoginResult,
  AdminView,
  AuditFilter,
  AuditView,
  BillingOverview,
  ConfigView,
  CsvExport,
  PlanChange,
  SubscriptionView,
  SubscriptionsFilter,
  TicketUpdate,
  TicketView,
  TicketsFilter,
  DashboardView,
  HealthView,
  Page,
  QuestionInput,
  QuestionUpdate,
  QuestionView,
  QuestionsFilter,
  TransmissionContactView,
  TransmissionDetailView,
  TransmissionRowView,
  TransmissionsFilter,
  UserDetailView,
  UserRowView,
  UsersFilter,
} from './types.js'
import { auditQuery, questionsQuery, subscriptionsQuery, ticketsQuery, transmissionsQuery, usersQuery } from './query.js'

export interface AdminClientOptions {
  baseUrl: string
  language?: 'fr' | 'en'
  fetch?: typeof fetch
  /** Jeton refusé (expiré, révoqué, admin suspendu) : l'écran renvoie à la connexion. */
  onSessionLost?: () => void
}

export class AdminClient {
  private readonly api: ApiClient
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly onSessionLost: (() => void) | undefined

  constructor(options: AdminClientOptions) {
    const base: ApiClientOptions = { baseUrl: options.baseUrl, language: options.language ?? 'fr' }
    if (options.fetch) base.fetch = options.fetch
    this.api = new ApiClient(base)
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    const impl = options.fetch ?? fetch
    this.fetchImpl = (input, init) => impl(input, init)
    this.onSessionLost = options.onSessionLost
  }

  get token(): string | null {
    return this.api.accessToken
  }

  set token(value: string | null) {
    this.api.accessToken = value
  }

  // --- Session ----------------------------------------------------------------------

  login(input: { email: string; password: string; code: string }): Promise<AdminLoginResult> {
    return this.api.post<AdminLoginResult>('/admin/auth/login', input, { noRefresh: true })
  }

  me(): Promise<AdminView> {
    return this.get<AdminView>('/admin/me')
  }

  async logout(): Promise<void> {
    try {
      await this.post<{ logged_out: true }>('/admin/auth/logout')
    } finally {
      this.api.forgetSession()
    }
  }

  // --- BO-01 ------------------------------------------------------------------------

  dashboard(): Promise<DashboardView> {
    return this.get<DashboardView>('/admin/dashboard')
  }

  health(): Promise<HealthView> {
    return this.get<HealthView>('/admin/health')
  }

  // --- BO-02 ------------------------------------------------------------------------

  readonly users = {
    list: (filter: UsersFilter = {}): Promise<Page<UserRowView>> => this.get<Page<UserRowView>>(`/admin/users${usersQuery(filter)}`),
    get: (id: string): Promise<UserDetailView> => this.get<UserDetailView>(`/admin/users/${id}`),
    unblock: (id: string, reason: string): Promise<UserDetailView> => this.post<UserDetailView>(`/admin/users/${id}/unblock`, { reason }),
    regenerateOtp: (email: string): Promise<{ sent: true }> => this.post<{ sent: true }>('/admin/users/otp-regen', { email }),
    suspend: (id: string, reason: string): Promise<UserDetailView> => this.post<UserDetailView>(`/admin/users/${id}/suspend`, { reason }),
    changeEmail: (id: string, email: string, reason: string): Promise<UserDetailView> => this.put<UserDetailView>(`/admin/users/${id}/email`, { email, reason }),
    remove: (id: string, reason: string): Promise<{ deleted: true }> => this.delete<{ deleted: true }>(`/admin/users/${id}`, { reason }),
  }

  // --- BO-03 ------------------------------------------------------------------------

  readonly transmissions = {
    list: (filter: TransmissionsFilter = {}): Promise<Page<TransmissionRowView>> => this.get<Page<TransmissionRowView>>(`/admin/transmissions${transmissionsQuery(filter)}`),
    get: (id: string): Promise<TransmissionDetailView> => this.get<TransmissionDetailView>(`/admin/transmissions/${id}`),
    extendEscrow: (id: string, hours: 24 | 48, reason: string): Promise<TransmissionDetailView> =>
      this.post<TransmissionDetailView>(`/admin/transmissions/${id}/extend-escrow`, { hours, reason }),
    notify: (id: string, reason: string): Promise<{ notified: number }> => this.post<{ notified: number }>(`/admin/transmissions/${id}/notify`, { reason }),
    cancel: (id: string, reason: string): Promise<TransmissionDetailView> => this.delete<TransmissionDetailView>(`/admin/transmissions/${id}`, { reason }),
    unblockContact: (id: string, contactId: string, reason: string): Promise<TransmissionContactView> =>
      this.post<TransmissionContactView>(`/admin/transmissions/${id}/contacts/${contactId}/unblock`, { reason }),
  }

  // --- BO-04 ------------------------------------------------------------------------

  readonly questions = {
    list: (filter: QuestionsFilter = {}): Promise<QuestionView[]> => this.get<QuestionView[]>(`/admin/questions${questionsQuery(filter)}`),
    create: (input: QuestionInput): Promise<QuestionView> => this.post<QuestionView>('/admin/questions', input),
    update: (id: string, changes: QuestionUpdate): Promise<QuestionView> => this.put<QuestionView>(`/admin/questions/${id}`, changes),
    archive: (id: string, reason: string): Promise<QuestionView> => this.put<QuestionView>(`/admin/questions/${id}/archive`, { reason }),
  }

  // --- BO-05 ------------------------------------------------------------------------

  readonly config = {
    list: (): Promise<ConfigView[]> => this.get<ConfigView[]>('/admin/config'),
    update: (key: string, value: unknown, reason: string): Promise<ConfigView> => this.put<ConfigView>(`/admin/config/${key}`, { value, reason }),
  }

  // --- BO-07 ------------------------------------------------------------------------

  readonly billing = {
    overview: (): Promise<BillingOverview> => this.get<BillingOverview>('/admin/billing/overview'),
    subscriptions: (filter: SubscriptionsFilter = {}): Promise<Page<SubscriptionView>> =>
      this.get<Page<SubscriptionView>>(`/admin/billing/subscriptions${subscriptionsQuery(filter)}`),
    changePlan: (id: string, change: PlanChange): Promise<SubscriptionView> => this.put<SubscriptionView>(`/admin/billing/${id}/plan`, change),
    extend: (id: string, days: number, reason: string): Promise<SubscriptionView> => this.post<SubscriptionView>(`/admin/billing/${id}/extend`, { days, reason }),
    /** Le CSV n'est pas enveloppé : requête brute, mêmes règles de session (401 = perdue). */
    exportCsv: (from: string, to: string): Promise<CsvExport> => this.download(`/admin/billing/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  }

  // --- BO-02 tickets ---------------------------------------------------------------

  readonly tickets = {
    list: (filter: TicketsFilter = {}): Promise<Page<TicketView>> => this.get<Page<TicketView>>(`/admin/tickets${ticketsQuery(filter)}`),
    get: (id: string): Promise<TicketView> => this.get<TicketView>(`/admin/tickets/${id}`),
    update: (id: string, changes: TicketUpdate): Promise<TicketView> => this.put<TicketView>(`/admin/tickets/${id}`, changes),
    /** Prise en charge : assigné à l'admin connecté, statut en cours (décision du 12/09/2026 : à soi-même seulement). */
    take: (id: string, adminId: string): Promise<TicketView> => this.put<TicketView>(`/admin/tickets/${id}`, { status: 'in_progress', assigned_to: adminId }),
  }

  // --- BO-06 ------------------------------------------------------------------------

  audit(filter: AuditFilter = {}): Promise<Page<AuditView>> {
    return this.get<Page<AuditView>>(`/admin/logs/audit${auditQuery(filter)}`)
  }

  // --- Transport --------------------------------------------------------------------

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body)
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    const options: RequestOptions = { noRefresh: true }
    try {
      return await this.api.request<T>(method, path, body, options)
    } catch (err) {
      this.noteSessionLoss(err)
      throw err
    }
  }

  private noteSessionLoss(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      this.api.forgetSession()
      this.onSessionLost?.()
    }
  }

  /** Une réponse fichier (text/csv) : hors enveloppe, mais une erreur reste une enveloppe { success: false }. */
  private async download(path: string): Promise<CsvExport> {
    const headers: Record<string, string> = { Accept: 'text/csv' }
    if (this.api.accessToken) headers['Authorization'] = `Bearer ${this.api.accessToken}`
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'GET', headers })
    const text = await res.text()
    if (!res.ok) {
      let body: { code: string; message: string; details?: unknown } = { code: 'HTTP_ERROR', message: `HTTP ${res.status}` }
      try {
        const parsed = JSON.parse(text) as { success?: boolean; error?: typeof body }
        if (parsed.success === false && parsed.error) body = parsed.error
      } catch {
        /* pas une enveloppe */
      }
      const err = new ApiError(res.status, body)
      this.noteSessionLoss(err)
      throw err
    }
    const disposition = res.headers.get('content-disposition') ?? ''
    const m = /filename="([^"]+)"/.exec(disposition)
    return { filename: m?.[1] ?? 'export.csv', csv: text }
  }
}
