// Grille des rôles du back office (Back Office Specs v1.1 §2) — la même que
// les preHandler de l'API : super_admin partout ; admin tout sauf la
// configuration (super_admin) et la facturation (finance) ; support :
// utilisateurs, transmissions, tickets ; finance : facturation seulement.
import { describe, expect, it } from 'vitest'
import { canAccess, homeModule, MODULES, modulesFor } from '../src/roles.js'

describe('canAccess', () => {
  it('super_admin accède à tout', () => {
    for (const m of MODULES) expect(canAccess('super_admin', m)).toBe(true)
  })

  it('admin : tout sauf config et facturation', () => {
    expect(modulesFor('admin')).toEqual(['dashboard', 'users', 'transmissions', 'questions', 'monitoring', 'tickets'])
    expect(canAccess('admin', 'config')).toBe(false)
    expect(canAccess('admin', 'billing')).toBe(false)
  })

  it('support : utilisateurs, transmissions, tickets — pas le tableau de bord', () => {
    expect(modulesFor('support')).toEqual(['users', 'transmissions', 'tickets'])
    expect(canAccess('support', 'dashboard')).toBe(false)
  })

  it('finance : facturation seulement', () => {
    expect(modulesFor('finance')).toEqual(['billing'])
  })

  it('un rôle inconnu n’accède à rien', () => {
    expect(modulesFor('stagiaire')).toEqual([])
    expect(canAccess('', 'users')).toBe(false)
  })
})

describe('homeModule', () => {
  it('le premier module accessible dans l’ordre du menu ; null sans accès', () => {
    expect(homeModule('super_admin')).toBe('dashboard')
    expect(homeModule('support')).toBe('users')
    expect(homeModule('finance')).toBe('billing')
    expect(homeModule('inconnu')).toBeNull()
  })
})
