import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── my-dashboard royalty rate (B4, Agent 46) + reconciliation (B6, Agent 47) ─────────
// B4: the franchise dashboard uses the SAME resolveFranchiseRate helper as the accrual
// (lib/franchise-royalty), per brand, default 6%. So the dashboard ESTIMATE equals the
// real held-back rate. royaltiesDue = sum of per-POS royalties. With a uniform 6% it
// equals the pre-B4 revenue×0.06 (invariant).
// B6: the dashboard ALSO returns the AUTHORITATIVE totals (accrued/settled/pending) read
// from FranchiseRoyalty + a royaltyEnabled flag to label the estimate. Prisma + next-auth
// mocked.

const { db, getSession } = vi.hoisted(() => ({
  db: {
    pointOfSale:      { findMany: vi.fn() },
    order:            { findMany: vi.fn() },
    franchiseRoyalty: { groupBy: vi.fn() }, // B6 — authoritative totals
  },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET } from '@/app/api/franchise/my-dashboard/route'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FRANCHISE_ROYALTY_ENABLED
  getSession.mockResolvedValue({ user: { id: 'op1' } })
  db.order.findMany.mockResolvedValue([])           // prev-window
  db.franchiseRoyalty.groupBy.mockResolvedValue([]) // B6 — default no accrual
})

describe('GET /api/franchise/my-dashboard — per-brand royalty rate', () => {
  it('each POS uses its brand rate; royaltiesDue = sum of per-POS royalties', async () => {
    db.pointOfSale.findMany.mockResolvedValue([
      { id: 'p1', name: 'POS1', city: 'Orange',   brand_ref: { royaltyPct: 0.08 }, orders: [{ subtotal: 100 }, { subtotal: 50 }] }, // 150 × 8% = 12
      { id: 'p2', name: 'POS2', city: 'Avignon',  brand_ref: null,                  orders: [{ subtotal: 200 }] },                   // 200 × 6% = 12
    ])
    const body = await (await GET()).json()
    expect(body.revenueThisMonth).toBe(350)
    expect(body.brands[0].royalties).toBeCloseTo(12, 6) // 8% brand
    expect(body.brands[1].royalties).toBeCloseTo(12, 6) // null brand → 6% default
    expect(body.royaltiesDue).toBeCloseTo(24, 6)        // sum of per-POS
    // it pulled the per-brand rate source
    expect(db.pointOfSale.findMany.mock.calls[0][0].include.brand_ref).toEqual({ select: { royaltyPct: true } })
  })

  it('INVARIANT — uniform 6% (all brands null/6%) → royaltiesDue == revenueThisMonth × 0.06 (byte-identical)', async () => {
    db.pointOfSale.findMany.mockResolvedValue([
      { id: 'p1', name: 'A', city: '', brand_ref: null,                 orders: [{ subtotal: 150 }] },
      { id: 'p2', name: 'B', city: '', brand_ref: { royaltyPct: 0.06 }, orders: [{ subtotal: 200 }] },
    ])
    const body = await (await GET()).json()
    expect(body.revenueThisMonth).toBe(350)
    expect(body.royaltiesDue).toBeCloseTo(350 * 0.06, 6) // == pre-B4 formula
  })

  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})

describe('GET /api/franchise/my-dashboard — B6 authoritative reconciliation', () => {
  beforeEach(() => {
    db.pointOfSale.findMany.mockResolvedValue([
      { id: 'p1', name: 'A', city: '', brand_ref: null, orders: [{ subtotal: 100 }] },
    ])
  })

  it('adds accrued/settled/pending (euros) from FranchiseRoyalty, owner-scoped', async () => {
    db.franchiseRoyalty.groupBy.mockResolvedValue([
      { status: 'pending',  _sum: { royaltyCents: 300 } },
      { status: 'settling', _sum: { royaltyCents: 200 } },
      { status: 'settled',  _sum: { royaltyCents: 500 } },
    ])
    const body = await (await GET()).json()
    expect(body.royaltiesAccrued).toBeCloseTo(10, 6) // 1000c
    expect(body.royaltiesSettled).toBeCloseTo(5, 6)  // 500c
    expect(body.royaltiesPending).toBeCloseTo(5, 6)  // 300+200c
    // owner-scoped to the session operator
    expect(db.franchiseRoyalty.groupBy.mock.calls[0][0].where).toEqual({ franchisorOperatorId: 'op1' })
    // estimate still present + distinct from authoritative
    expect(body.royaltiesDue).toBeCloseTo(6, 6) // 100 × 6%
  })

  it('royaltyEnabled reflects the held-back flag (OFF by default → estimate is a projection)', async () => {
    const off = await (await GET()).json()
    expect(off.royaltyEnabled).toBe(false)
    expect(off.royaltiesAccrued).toBe(0) // no accrual rows → 0
    process.env.FRANCHISE_ROYALTY_ENABLED = 'true'
    const on = await (await GET()).json()
    expect(on.royaltyEnabled).toBe(true)
  })
})
