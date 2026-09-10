// Client Prisma partagé. Le schéma vit dans prisma/schema.prisma à la racine du
// dépôt, généré par introspection — voir docs/schema-postgresql.md §3.

import { PrismaClient } from '@prisma/client'

let client: PrismaClient | undefined

export function prisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  }
  return client
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = undefined
  }
}

export type { PrismaClient }
