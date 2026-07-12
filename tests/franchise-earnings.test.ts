import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/franchise-earnings — authoritative royalty aggregation (B6, Agent 47) ────────
// Read-only. getFranchiseEarnings sums FranchiseRoyalty.royaltyCents by status (owner-
// scoped by franchisorOperatorId): accrued = all, settled = 'settled', pending =
// 'pending'+'settling'. INVARIANT: settled ≤ accrued, pending = accrued − settled.
// getFranchisePayouts reads Payout role='franchise' for the operator, newest first.

const { db } = vi.hoisted(() => ({
  db: {
    franchiseRoyalty: { groupBy: vi.fn() },
    payout:           { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { getFranchiseEarnings, getFranchisePayouts } from '@/lib/franchise-earnings'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getFranchiseEarnings', () => {
  it('sums by status: accrued = all, settled = settled, pending = pending+settling', async () => {
    db.franchiseRoyalty.groupBy.mockResolvedValue([
      { status: 'pending',  _sum: { royaltyCents: 300 } },
      { status: 'settling', _sum: { royaltyCents: 200 } },
      { status: 'settled',  _sum: { royaltyCents: 500 } },
    ])
    const e = await getFranchiseEarnings('op1')
    expect(e.accruedCents).toBe(1000)
    expect(e.settledCents).toBe(500)
    expect(e.pendingCents).toBe(500)            // pending(300) + settling(200)
    // INVARIANTS
    expect(e.settledCents).toBeLessThanOrEqual(e.accruedCents)
    expect(e.pendingCents).toBe(e.accruedCents - e.settledCents)
  })

  it('owner-scoped: groups by the passed franchisorOperatorId only', async () => {
    db.franchiseRoyalty.groupBy.mockResolvedValue([])
    await getFranchiseEarnings('op-me')
    const arg = db.franchiseRoyalty.groupBy.mock.calls[0][0]
    expect(arg.where).toEqual({ franchisorOperatorId: 'op-me' })
    expect(arg.by).toEqual(['status'])
  })

  it('no rows → all zero', async () => {
    db.franchiseRoyalty.groupBy.mockResolvedValue([])
    expect(await getFranchiseEarnings('op1')).toEqual({ accruedCents: 0, settledCents: 0, pendingCents: 0 })
  })

  it('null _sum (empty bucket) is treated as 0', async () => {
    db.franchiseRoyalty.groupBy.mockResolvedValue([
      { status: 'pending', _sum: { royaltyCents: null } },
      { status: 'settled', _sum: { royaltyCents: 700 } },
    ])
    const e = await getFranchiseEarnings('op1')
    expect(e).toEqual({ accruedCents: 700, settledCents: 700, pendingCents: 0 })
  })
})

describe('getFranchisePayouts', () => {
  it('owner-scoped to role=franchise + operatorId, newest first', async () => {
    db.payout.findMany.mockResolvedValue([{ id: 'po1', amountCents: 500, currency: 'eur', status: 'paid', paidAt: null, stripeTransferId: 'tr_1', createdAt: new Date(0) }])
    const rows = await getFranchisePayouts('op-me')
    expect(rows).toHaveLength(1)
    const arg = db.payout.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ role: 'franchise', operatorId: 'op-me' })
    expect(arg.orderBy).toEqual({ createdAt: 'desc' })
  })
})
