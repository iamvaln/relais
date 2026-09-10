// Lecture des paramètres BO-05 (table app_config), avec valeur de repli.

import { prisma } from './prisma.js'

export async function configInt(key: string, fallback: number): Promise<number> {
  const row = await prisma().app_config.findUnique({ where: { key }, select: { value: true } })
  const n = row ? Number.parseInt(row.value, 10) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}
