// @relais/api-client — client TypeScript de l'API Relais.

import { ApiClient as BaseClient, type ApiClientOptions } from './client.js'
import { AuthApi } from './auth.js'

export * from './errors.js'
export * from './cookies.js'
export * from './auth.js'
export type { ApiClientOptions, RequestOptions } from './client.js'

export class ApiClient extends BaseClient {
  readonly auth: AuthApi
  constructor(options: ApiClientOptions) {
    super(options)
    this.auth = new AuthApi(this)
  }
}
