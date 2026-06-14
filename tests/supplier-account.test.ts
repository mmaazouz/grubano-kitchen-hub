import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── ensureSupplierOperator — supplier auth bridge (B2B Slice 0, Agent 14) ─────
// Fresh email → passwordless supplier Operator. Existing account of ANOTHER role
// → the 'supplier' role is ADDED to its SET on approval WITHOUT touching its
// primary role/password (multi-role cumul). The role is recorded only on approval
// (activate). Idempotent + tolerant — mirrors the creator bridge contract.

const { db } = vi.hoisted(() => ({
  db: {
    operator:     { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    operatorRole: { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { ensureSupplierOperator } from '@/lib/supplier-account'

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.create.mockResolvedValue({ id: 'opNew' })
  db.operator.update.mockResolvedValue({})
  db.operatorRole.upsert.mockResolvedValue({})
})

describe('fresh email → passwordless supplier Operator', () => {
  it('register (activate:false) → pending supplier, no password, role NOT yet granted', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureSupplierOperator('s@x.fr', 'S', { activate: false })
    expect(r).toEqual({ ok: true, created: true, activated: false, roleAdded: false })
    const data = db.operator.create.mock.calls[0][0].data
    expect(data).toMatchObject({ role: 'supplier', status: 'pending' })
    expect(data.password).toBeUndefined()
    expect(db.operatorRole.upsert).not.toHaveBeenCalled() // role only on approval
  })

  it('approval (activate:true) → active supplier + role recorded in the SET', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureSupplierOperator('s@x.fr', 'S', { activate: true })
    expect(r).toEqual({ ok: true, created: true, activated: true, roleAdded: true })
    expect(db.operator.create.mock.calls[0][0].data.status).toBe('active')
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opNew', role: 'supplier' } },
    }))
  })
})

describe('existing ANOTHER-role account → multi-role cumul (no clobber)', () => {
  it('a RESTAURANT that registers as supplier GAINS the role on approval; primary untouched', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opR', role: 'restaurant', status: 'active' })
    const r = await ensureSupplierOperator('r@x.fr', 'R', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: true })
    // Primary role + password + status NEVER touched (no operator.create / update).
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(db.operator.update).not.toHaveBeenCalled()
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opR', role: 'supplier' } },
    }))
  })

  it('at registration (activate:false) the role is NOT yet granted', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opR', role: 'restaurant', status: 'active' })
    const r = await ensureSupplierOperator('r@x.fr', 'R', { activate: false })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: false })
    expect(db.operatorRole.upsert).not.toHaveBeenCalled()
  })
})

describe('existing PRIMARY supplier', () => {
  it('activates a pending supplier on approval (never downgrades) + role idempotent', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opS', role: 'supplier', status: 'pending' })
    const r = await ensureSupplierOperator('s@x.fr', 'S', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: true, roleAdded: true })
    expect(db.operator.update).toHaveBeenCalledWith({ where: { id: 'opS' }, data: { status: 'active' } })
  })

  it('already-active supplier → no status write, role still ensured', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opS', role: 'supplier', status: 'active' })
    const r = await ensureSupplierOperator('s@x.fr', 'S', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: true })
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})

describe('best-effort (never throws)', () => {
  it('a DB error → { ok:false, reason:error }, no throw', async () => {
    db.operator.findUnique.mockRejectedValue(new Error('db down'))
    expect(await ensureSupplierOperator('s@x.fr', 'S', { activate: true })).toEqual({ ok: false, reason: 'error' })
  })
})
