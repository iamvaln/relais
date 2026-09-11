// npm run admin:create -- --email v@relais.app --name "Valentine" --role super_admin
// Le mot de passe est lu dans ADMIN_PASSWORD ou demandé au clavier.

import { createInterface } from 'node:readline/promises'
import { createAdmin } from '../api/admin/bootstrap.js'
import { disconnectPrisma } from '../lib/prisma.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const email = arg('email')
  const name = arg('name')
  const role = arg('role') ?? 'super_admin'
  if (!email || !name) {
    console.error('usage : npm run admin:create -- --email <email> --name <nom> [--role super_admin|admin|support|finance]')
    process.exit(2)
  }
  let password = process.env.ADMIN_PASSWORD
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    password = await rl.question('Mot de passe (10+ caractères, majuscule, chiffre, spécial) : ')
    rl.close()
  }
  const created = await createAdmin({ email, full_name: name, password, role })
  console.log(`Admin créé : ${created.id}`)
  console.log(`Secret TOTP (à scanner une fois, jamais réaffiché) : ${created.totp_secret}`)
  console.log(created.otpauth_uri)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => disconnectPrisma())
