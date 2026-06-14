import { describe, it, expect } from 'vitest'
import { spacesForRoles, hasAnyRole, currentSpace } from '@/lib/role-spaces'

// ── Role → space mapping (Phase 4 refonte, Agent 14) ──────────────────────────
// The display-time source of truth that drives the role-aware nav + the multi-
// role switcher. Pure; never grants access (middleware is the gate).

describe('hasAnyRole (nav role gate)', () => {
  it('true on intersection, false otherwise / on missing set', () => {
    expect(hasAnyRole(['restaurant'], ['restaurant', 'admin'])).toBe(true)
    expect(hasAnyRole(['admin'], ['restaurant', 'admin'])).toBe(true)
    expect(hasAnyRole(['creator'], ['restaurant', 'admin'])).toBe(false) // the leak fix
    expect(hasAnyRole(['consumer', 'creator'], ['restaurant', 'admin'])).toBe(false)
    expect(hasAnyRole(undefined, ['restaurant'])).toBe(false)
    expect(hasAnyRole([], ['restaurant'])).toBe(false)
  })
})

describe('spacesForRoles', () => {
  it('mono-role → exactly one space', () => {
    expect(spacesForRoles(['restaurant']).map((s) => s.href)).toEqual(['/dashboard'])
    expect(spacesForRoles(['creator']).map((s) => s.href)).toEqual(['/creators/dashboard'])
    expect(spacesForRoles(['consumer']).map((s) => s.href)).toEqual(['/eat'])
    expect(spacesForRoles(['franchise']).map((s) => s.href)).toEqual(['/franchise'])
  })

  it('multi-role {consumer, creator} → both spaces, NO restaurant', () => {
    const hrefs = spacesForRoles(['consumer', 'creator']).map((s) => s.href)
    expect(hrefs).toContain('/eat')
    expect(hrefs).toContain('/creators/dashboard')
    expect(hrefs).not.toContain('/dashboard')
    expect(hrefs).toHaveLength(2)
  })

  it('never includes a space for an UNHELD role', () => {
    expect(spacesForRoles(['consumer']).some((s) => s.key === 'restaurant')).toBe(false)
    expect(spacesForRoles(['consumer']).some((s) => s.key === 'creator')).toBe(false)
  })

  it('dedups admin + restaurant to a single /dashboard space', () => {
    expect(spacesForRoles(['restaurant', 'admin']).map((s) => s.href)).toEqual(['/dashboard'])
  })

  it('empty / missing set → no spaces (no switcher)', () => {
    expect(spacesForRoles([])).toEqual([])
    expect(spacesForRoles(undefined)).toEqual([])
  })
})

describe('currentSpace (active highlight by pathname)', () => {
  const spaces = spacesForRoles(['consumer', 'creator'])
  it('matches the space whose home prefixes the path (longest wins)', () => {
    expect(currentSpace('/creators/dashboard', spaces)?.key).toBe('creator')
    expect(currentSpace('/creators/dashboard/revenus', spaces)?.key).toBe('creator')
    expect(currentSpace('/eat/account', spaces)?.key).toBe('consumer')
  })
  it('null when no space owns the path', () => {
    expect(currentSpace('/menu', spaces)).toBeNull()
  })
})
