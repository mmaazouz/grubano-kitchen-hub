import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── ensureCreatorOperator — the creator auth bridge (Phase 0, Agent 14) ───────
// Gives a creator a PASSWORDLESS Operator(role='creator'); activates on approval;
// NEVER clobbers an Operator that already belongs to another role.

const { db } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { ensureCreatorOperator } from '@/lib/creator-account'

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.create.mockResolvedValue({ id: 'op1' })
  db.operator.update.mockResolvedValue({})
})

describe('no existing Operator → create passwordless creator', () => {
  it('apply (activate:false) → status pending, role creator, no password', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: false })
    expect(r).toEqual({ ok: true, created: true, activated: false })
    const data = db.operator.create.mock.calls[0][0].data
    expect(data).toMatchObject({ role: 'creator', status: 'pending' })
    expect(data.password).toBeUndefined()
  })
  it('approval (activate:true) → status active', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: true })
    expect(r).toEqual({ ok: true, created: true, activated: true })
    expect(db.operator.create.mock.calls[0][0].data.status).toBe('active')
  })
})

describe('existing creator Operator', () => {
  it('activates a pending creator on approval (never downgrades)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opC', role: 'creator', status: 'pending' })
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: true })
    expect(db.operator.update).toHaveBeenCalledWith({ where: { id: 'opC' }, data: { status: 'active' } })
  })
  it('no-op when already active', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opC', role: 'creator', status: 'active' })
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: false })
    expect(db.operator.update).not.toHaveBeenCalled()
    expect(db.operator.create).not.toHaveBeenCalled()
  })
})

describe('email already owned by another role → never clobber', () => {
  it('consumer account → email_taken_other_role, no write', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opU', role: 'consumer', status: 'active' })
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: true })
    expect(r).toEqual({ ok: false, reason: 'email_taken_other_role', role: 'consumer' })
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})

describe('best-effort (never throws)', () => {
  it('a DB error → { ok:false, reason:error }, no throw', async () => {
    db.operator.findUnique.mockRejectedValue(new Error('column not migrated'))
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: false })
    expect(r).toEqual({ ok: false, reason: 'error' })
  })
})
