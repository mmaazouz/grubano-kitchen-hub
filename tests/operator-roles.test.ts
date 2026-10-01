import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── readOperatorRoles — multi-role reader (Phase 1 refonte, Agent 14) ─────────
// Unions the legacy primary role with the OperatorRole rows; ALWAYS includes the
// primary; tolerant (table missing / DB error → primary only = mono-role).

const { db } = vi.hoisted(() => ({ db: { operatorRole: { findMany: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { readOperatorRoles } from '@/lib/operator-roles'

beforeEach(() => vi.clearAllMocks())

describe('readOperatorRoles', () => {
  it('unions the primary role with the OperatorRole rows (deduped)', async () => {
    db.operatorRole.findMany.mockResolvedValue([{ role: 'creator' }, { role: 'restaurant' }, { role: 'creator' }])
    expect((await readOperatorRoles('op1', 'creator')).sort()).toEqual(['creator', 'restaurant'])
  })

  it('ALWAYS includes the primary role even if the rows omit it (no access loss)', async () => {
    db.operatorRole.findMany.mockResolvedValue([{ role: 'restaurant' }])
    expect((await readOperatorRoles('op1', 'creator')).sort()).toEqual(['creator', 'restaurant'])
  })

  it('mono-role (no rows) → just the primary', async () => {
    db.operatorRole.findMany.mockResolvedValue([])
    expect(await readOperatorRoles('op1', 'consumer')).toEqual(['consumer'])
  })

  it('TOLERANT: table missing / DB error → primary role only, never throws', async () => {
    db.operatorRole.findMany.mockRejectedValue(new Error('table OperatorRole does not exist'))
    expect(await readOperatorRoles('op1', 'restaurant')).toEqual(['restaurant'])
  })

  it('DEFENSIVE: a falsy primary role never yields an empty set (→ consumer)', async () => {
    db.operatorRole.findMany.mockResolvedValue([])
    expect(await readOperatorRoles('op1', '')).toEqual(['consumer'])
  })
})
