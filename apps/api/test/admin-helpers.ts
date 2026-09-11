// Un admin connecté, pour les tests des modules du back office.

import * as OTPAuth from 'otpauth'
import { createAdmin } from '../src/api/admin/bootstrap.js'
import { api } from './helpers.js'

export const ADMIN_PASSWORD = 'Super-Admin-Pass-9!'

export function totpCode(secret: string): string {
  return new OTPAuth.TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).generate()
}

export async function loginAdmin(role = 'super_admin', email = `${role}@relais.app`) {
  const created = await createAdmin({ email, full_name: `Admin ${role}`, password: ADMIN_PASSWORD, role })
  const r = await (await api()).post('/admin/auth/login').send({ email, password: ADMIN_PASSWORD, code: totpCode(created.totp_secret) }).expect(200)
  const token = r.body.data.access_token as string
  return { id: created.id, email, role, token, auth: { Authorization: `Bearer ${token}` } }
}
