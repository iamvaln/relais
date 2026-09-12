// Grille des rôles (Back Office Specs v1.1 §2), identique aux preHandler de
// l'API : le menu ne montre que ce que le rôle peut ouvrir (décision du
// 12/09/2026) — l'API refuse de toute façon (AUTH_FORBIDDEN).

export const ADMIN_ROLES = ['super_admin', 'admin', 'support', 'finance'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

/** Dans l'ordre du menu. */
export const MODULES = ['dashboard', 'users', 'transmissions', 'questions', 'config', 'monitoring', 'billing', 'tickets'] as const
export type Module = (typeof MODULES)[number]

const GRID: Record<AdminRole, readonly Module[]> = {
  super_admin: MODULES,
  admin: ['dashboard', 'users', 'transmissions', 'questions', 'monitoring', 'tickets'],
  support: ['users', 'transmissions', 'tickets'],
  finance: ['billing'],
}

function isRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role)
}

export function modulesFor(role: string): Module[] {
  return isRole(role) ? [...GRID[role]] : []
}

export function canAccess(role: string, module: Module): boolean {
  return modulesFor(role).includes(module)
}

/** Le premier module accessible : la page d'accueil après connexion. */
export function homeModule(role: string): Module | null {
  return modulesFor(role)[0] ?? null
}
