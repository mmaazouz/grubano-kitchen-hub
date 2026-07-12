import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/customer-scope — SEC fix: cross-resto PII on /customers ────────────────
// Before the fix, /customers ran an UNSCOPED loyaltyCustomer.findMany: any
// authenticated restaurateur saw the whole platform's top-20 loyalty customers
// (name+email+phone). The scoped query must guarantee: RESTO A NEVER SEES A
// CUSTOMER WHO NEVER ORDERED CHEZ LUI. Two attachment paths:
//   A. LoyaltyOrder → Brand.operatorId          (UberEats validation flow)
//   B. /eat Order at my Restaurant → consumer email (delivered-credit flow)

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:      { findMany: vi.fn() },
    order:           { findMany: vi.fn() },
    operator:        { findMany: vi.fn() },
    loyaltyCustomer: { findMany: vi.fn(), count: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { getScopedCustomers, loyaltyCustomerWhereForOperator } from '@/lib/customer-scope'

const OP_A = 'op-resto-A'

beforeEach(() => {
  vi.clearAllMocks()
  // Option B: an operator can own SEVERAL establishments.
  db.restaurant.findMany.mockResolvedValue([{ id: 'resto-A' }, { id: 'resto-A2' }])
  db.order.findMany.mockResolvedValue([{ consumerId: 'cons-1' }, { consumerId: 'cons-2' }])
  db.operator.findMany.mockResolvedValue([{ email: 'c1@x.fr' }, { email: 'c2@x.fr' }])
  db.loyaltyCustomer.findMany.mockResolvedValue([])
  db.loyaltyCustomer.count.mockResolvedValue(0)
})

describe('loyaltyCustomerWhereForOperator — the tenant fence', () => {
  it('scopes to MY brands (path A) OR MY restaurant customers by email (path B)', async () => {
    const where = await loyaltyCustomerWhereForOperator(OP_A)
    expect(where).toEqual({
      OR: [
        { orders: { some: { brand: { operatorId: OP_A } } } },
        { email: { in: ['c1@x.fr', 'c2@x.fr'] } },
      ],
    })
    // Path B resolved from MY establishments only (multi-restaurant, Option B).
    expect(db.restaurant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { operatorId: OP_A } }),
    )
    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { restaurantId: { in: ['resto-A', 'resto-A2'] } } }),
    )
  })

  it('a customer of resto B only is EXCLUDED by construction (never in the fence)', async () => {
    const where = await loyaltyCustomerWhereForOperator(OP_A)
    // The victim: LoyaltyCustomer 'victim@restoB.fr' — no LoyaltyOrder on A's
    // brands, never ordered at resto A. Neither OR branch can match them:
    const orBranches = (where as { OR: Record<string, unknown>[] }).OR
    // branch A filters on operatorId = resto A (victim's orders are on B's brands)
    expect(orBranches[0]).toEqual({ orders: { some: { brand: { operatorId: OP_A } } } })
    // branch B is a CLOSED email list built from resto A's own orders
    expect(orBranches[1]).toEqual({ email: { in: ['c1@x.fr', 'c2@x.fr'] } })
    expect((orBranches[1] as { email: { in: string[] } }).email.in).not.toContain('victim@restoB.fr')
  })

  it('no restaurant profile → fence reduces to path A only (no open email branch)', async () => {
    db.restaurant.findMany.mockResolvedValue([])
    const where = await loyaltyCustomerWhereForOperator(OP_A)
    expect(where).toEqual({ OR: [{ orders: { some: { brand: { operatorId: OP_A } } } }] })
    expect(db.order.findMany).not.toHaveBeenCalled()
  })

  it('restaurant with zero orders → NO email branch (empty in-list would match nothing, but we drop it entirely)', async () => {
    db.order.findMany.mockResolvedValue([])
    const where = await loyaltyCustomerWhereForOperator(OP_A)
    expect(where).toEqual({ OR: [{ orders: { some: { brand: { operatorId: OP_A } } } }] })
    expect(db.operator.findMany).not.toHaveBeenCalled()
  })
})

describe('getScopedCustomers — role behaviour', () => {
  it('restaurant role → findMany AND count receive the SCOPED where (never {})', async () => {
    await getScopedCustomers({ id: OP_A, roles: ['restaurant'] })
    const expectedWhere = {
      OR: [
        { orders: { some: { brand: { operatorId: OP_A } } } },
        { email: { in: ['c1@x.fr', 'c2@x.fr'] } },
      ],
    }
    expect(db.loyaltyCustomer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, take: 20 }),
    )
    expect(db.loyaltyCustomer.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    )
  })

  it('multi-role WITHOUT admin (restaurant+creator) → still scoped', async () => {
    await getScopedCustomers({ id: OP_A, roles: ['restaurant', 'creator'] })
    const call = db.loyaltyCustomer.findMany.mock.calls[0][0]
    expect(call.where).not.toEqual({})
    expect(call.where.OR[0]).toEqual({ orders: { some: { brand: { operatorId: OP_A } } } })
  })

  it('admin → platform-wide (unscoped) view, no tenant resolution queries', async () => {
    await getScopedCustomers({ id: 'op-admin', roles: ['admin'] })
    expect(db.loyaltyCustomer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
    expect(db.restaurant.findMany).not.toHaveBeenCalled()
  })

  it('returns only display scalars (no raw record pass-through)', async () => {
    db.loyaltyCustomer.findMany.mockResolvedValue([{
      id: 'lc1', name: 'Client Un', email: 'c1@x.fr', phone: null,
      pointsBalance: 120, tier: 'silver', createdAt: new Date('2026-01-01'),
      referralCode: 'SECRET-CODE', referredBy: 'other',   // ← must NOT leak through
    }])
    db.loyaltyCustomer.count.mockResolvedValue(1)
    const { customers, total } = await getScopedCustomers({ id: OP_A, roles: ['restaurant'] })
    expect(total).toBe(1)
    expect(customers[0]).toEqual({
      id: 'lc1', name: 'Client Un', email: 'c1@x.fr', phone: null,
      pointsBalance: 120, tier: 'silver', createdAt: new Date('2026-01-01'),
    })
    expect(customers[0]).not.toHaveProperty('referralCode')
  })
})
