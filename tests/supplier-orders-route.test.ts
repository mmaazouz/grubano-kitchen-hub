import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/supplier/orders — supplier reception scoping (Slice 2, Agent 14) ─────
// A supplier sees ONLY the orders placed to its own SupplierProfile (from the
// session). Isolation between suppliers is enforced by the where-scope.

const { db, caller } = vi.hoisted(() => ({
  db: { supplyOrder: { findMany: vi.fn() } },
  caller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-account', () => ({ callerSupplierProfile: caller }))

import { GET } from '@/app/api/supplier/orders/route'

beforeEach(() => vi.clearAllMocks())

describe('GET /api/supplier/orders', () => {
  it('scopes findMany to the CALLER supplier profile (isolation)', async () => {
    caller.mockResolvedValue({ id: 'sp1', status: 'active' })
    db.supplyOrder.findMany.mockResolvedValue([])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(db.supplyOrder.findMany.mock.calls[0][0].where).toEqual({ supplierProfileId: 'sp1' })
  })

  it('401 when the caller is not a supplier', async () => {
    caller.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(db.supplyOrder.findMany).not.toHaveBeenCalled()
  })
})
