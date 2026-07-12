import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── ensureCreatorOperator — creator auth bridge (Phase 0 → Phase 3, Agent 14) ─
// Fresh email → passwordless creator Operator (Phase 0). Existing account of
// ANOTHER role → the 'creator' role is ADDED to its SET on approval WITHOUT
// touching its primary role/password (Phase 3 multi-role cumul). The role is
// recorded only on approval (activate). Idempotent + tolerant.

const { db } = vi.hoisted(() => ({
  db: {
    operator:     { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    operatorRole: { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { ensureCreatorOperator } from '@/lib/creator-account'

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.create.mockResolvedValue({ id: 'opNew' })
  db.operator.update.mockResolvedValue({})
  db.operatorRole.upsert.mockResolvedValue({})
})

describe('fresh email (Phase 0, non-regression)', () => {
  it('apply (activate:false) → pending creator, no password, role NOT yet granted', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: false })
    expect(r).toEqual({ ok: true, created: true, activated: false, roleAdded: false })
    const data = db.operator.create.mock.calls[0][0].data
    expect(data).toMatchObject({ role: 'creator', status: 'pending' })
    expect(data.password).toBeUndefined()
    expect(db.operatorRole.upsert).not.toHaveBeenCalled() // role only on approval
  })

  it('approval (activate:true) → active creator + role recorded in the SET', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: true })
    expect(r).toEqual({ ok: true, created: true, activated: true, roleAdded: true })
    expect(db.operator.create.mock.calls[0][0].data.status).toBe('active')
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opNew', role: 'creator' } },
    }))
  })
})

describe('existing PRIMARY creator', () => {
  it('activates a pending creator on approval (never downgrades) + role idempotent', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opC', role: 'creator', status: 'pending' })
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: true, roleAdded: true })
    expect(db.operator.update).toHaveBeenCalledWith({ where: { id: 'opC' }, data: { status: 'active' } })
  })
  it('already-active creator → no status write, role still ensured', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opC', role: 'creator', status: 'active' })
    const r = await ensureCreatorOperator('a@x.fr', 'A', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: true })
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})

describe('existing ANOTHER-role account → Phase 3 cumul (the gap closed)', () => {
  it('a consumer who completes a creator application GAINS the creator role, primary untouched', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opU', role: 'consumer', status: 'active' })
    const r = await ensureCreatorOperator('u@x.fr', 'U', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: true })
    // Primary role + password + status NEVER touched (no operator.create / update).
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(db.operator.update).not.toHaveBeenCalled()
    // The creator role is ADDED to the SET.
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opU', role: 'creator' } },
    }))
  })

  it('at APPLY (activate:false) the role is NOT yet granted (not approved)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opU', role: 'consumer', status: 'active' })
    const r = await ensureCreatorOperator('u@x.fr', 'U', { activate: false })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: false })
    expect(db.operatorRole.upsert).not.toHaveBeenCalled()
  })
})

describe('best-effort (never throws)', () => {
  it('a DB error → { ok:false, reason:error }, no throw', async () => {
    db.operator.findUnique.mockRejectedValue(new Error('db down'))
    expect(await ensureCreatorOperator('a@x.fr', 'A', { activate: true })).toEqual({ ok: false, reason: 'error' })
  })
})
