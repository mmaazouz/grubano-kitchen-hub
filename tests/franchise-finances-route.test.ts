import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/franchise/finances — franchisor earnings + settlements (B6, Agent 47) ───
// READ-ONLY. Owner-scoped via gateFranchise (operator from SESSION id, 'franchise' role
// required → no IDOR). Returns authoritative accrued/settled/pending (FranchiseRoyalty
// of THIS franchisor) + the Payout history (role='franchise', operatorId=session). Prisma
// + next-auth mocked (same style as franchise-pos-route).

const { db, getSession } = vi.hoisted(() => ({
  db: {
    operator:         { findUnique: vi.fn() },
    operatorRole:     { findMany: vi.fn() },
    franchiseRoyalty: { groupBy: vi.fn() },
    payout:           { findMany: vi.fn() },
    pointOfSale:      { findMany: vi.fn() }, // FR5 — breakdown POS names
    brand:            { findMany: vi.fn() }, // FR5 — real rate source
  },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET } from '@/app/api/franchise/finances/route'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FRANCHISE_ROYALTY_ENABLED
  getSession.mockResolvedValue({ user: { id: 'op1' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'franchise' })
  db.operatorRole.findMany.mockResolvedValue([]) // role set = ['franchise']
  db.franchiseRoyalty.groupBy.mockResolvedValue([
    { status: 'pending',  _sum: { royaltyCents: 300 } },
    { status: 'settled',  _sum: { royaltyCents: 500 } },
  ])
  db.payout.findMany.mockResolvedValue([
    { id: 'po1', amountCents: 500, currency: 'eur', status: 'paid', paidAt: new Date(0), stripeTransferId: 'tr_1', createdAt: new Date(0) },
  ])
  db.pointOfSale.findMany.mockResolvedValue([]) // FR5 breakdown names
  db.brand.findMany.mockResolvedValue([])       // FR5 rate source
})
afterEach(() => { delete process.env.FRANCHISE_ROYALTY_ENABLED })

describe('GET /api/franchise/finances', () => {
  it('returns authoritative totals + payouts, scoped to the SESSION franchisor', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.accruedCents).toBe(800)
    expect(j.settledCents).toBe(500)
    expect(j.pendingCents).toBe(300)
    expect(j.payouts).toHaveLength(1)
    expect(j.royaltyEnabled).toBe(false) // flag OFF by default
    // owner-scope: earnings by THIS franchisor, payouts by role+operator
    expect(db.franchiseRoyalty.groupBy.mock.calls[0][0].where).toEqual({ franchisorOperatorId: 'op1' })
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'franchise', operatorId: 'op1' })
  })

  it('royaltyEnabled reflects FRANCHISE_ROYALTY_ENABLED', async () => {
    process.env.FRANCHISE_ROYALTY_ENABLED = 'true'
    const j = await (await GET()).json()
    expect(j.royaltyEnabled).toBe(true)
  })

  it('unauthenticated → 401, no DB read', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(db.franchiseRoyalty.groupBy).not.toHaveBeenCalled()
    expect(db.payout.findMany).not.toHaveBeenCalled()
  })

  it('non-franchise role → 403, no DB read (no IDOR)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    expect((await GET()).status).toBe(403)
    expect(db.franchiseRoyalty.groupBy).not.toHaveBeenCalled()
    expect(db.payout.findMany).not.toHaveBeenCalled()
  })

  it('a franchisor only ever queries with ITS OWN operator id (no client id reaches scope)', async () => {
    getSession.mockResolvedValue({ user: { id: 'op-other' } })
    db.operator.findUnique.mockResolvedValue({ id: 'op-other', role: 'franchise' })
    await GET()
    expect(db.franchiseRoyalty.groupBy.mock.calls[0][0].where).toEqual({ franchisorOperatorId: 'op-other' })
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'franchise', operatorId: 'op-other' })
  })
})
