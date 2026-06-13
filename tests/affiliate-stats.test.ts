import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/creator/affiliate-stats — Dashboard Affiliés Slice 2a (Agent 14) ──
// Session-aware (Creator resolved from the SESSION email, never a ?creatorId →
// IDOR-safe), matured vs pending split, locked state for a non-influencer.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: {
    creator:        { findUnique: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    referralOrder:  { findMany: vi.fn() },
    referral:       { count: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { GET } from '@/app/api/creator/affiliate-stats/route'

const CREATOR = {
  id: 'cr1', referralCode: 'MARCO20', referralLinkSlug: 'marco20', isChef: true, isInfluencer: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'creator@example.com' } })
  db.creator.findUnique.mockResolvedValue(CREATOR)            // email lookup AND readCreatorRoles(id)
  db.referralConfig.findFirst.mockResolvedValue({ commissionPctOfGrubanoFee: 0.30 })
  db.referralOrder.findMany.mockResolvedValue([])
  db.referral.count.mockResolvedValue(0)
})

describe('auth + access', () => {
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('no creator profile → 404', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it('non-influencer → clean locked payload (isInfluencer:false, zeroed)', async () => {
    db.creator.findUnique.mockResolvedValue({ ...CREATOR, isInfluencer: false })
    const res = await GET()
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.isInfluencer).toBe(false)
    expect(out.earnings.maturedCents).toBe(0)
    expect(out.payout.status).toBe('activation_pending')
    // It must NOT query the earnings pipes for a locked influencer.
    expect(db.referralOrder.findMany).not.toHaveBeenCalled()
  })
})

describe('aggregation (matured vs pending) + session scoping', () => {
  const rows = [
    { id: 'ro1', status: 'matured',   creatorEarning: 1.00, newCustomerBonus: 0.50, createdAt: new Date('2026-05-10T10:00:00Z'),
      grubanoFee: 3.6, maturedAt: new Date('2026-05-17T10:00:00Z'), order: { total: 20, createdAt: new Date('2026-05-10T10:00:00Z'), restaurant: { name: 'R1' } } },
    { id: 'ro2', status: 'pending',   creatorEarning: 0.50, newCustomerBonus: 0,    createdAt: new Date('2026-06-02T10:00:00Z'),
      grubanoFee: 1.8, maturedAt: null, order: { total: 10, createdAt: new Date('2026-06-02T10:00:00Z'), restaurant: { name: 'R2' } } },
    { id: 'ro3', status: 'paid',      creatorEarning: 2.00, newCustomerBonus: 0,    createdAt: new Date('2026-04-01T10:00:00Z'),
      grubanoFee: 6.0, maturedAt: new Date('2026-04-08T10:00:00Z'), order: { total: 40, createdAt: new Date('2026-04-01T10:00:00Z'), restaurant: { name: 'R3' } } },
  ]

  beforeEach(() => {
    db.referralOrder.findMany.mockResolvedValue(rows)
    db.referral.count.mockResolvedValue(3)
  })

  it('splits matured vs pending (earning + bonus, in cents) and exposes the honest payout', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.isInfluencer).toBe(true)
    expect(out.earnings.maturedCents).toBe(150)  // 1.00 + 0.50 bonus
    expect(out.earnings.pendingCents).toBe(50)   // 0.50
    expect(out.payout.claimableCents).toBe(150)  // matured, gated
    expect(out.payout.status).toBe('activation_pending')
    expect(out.referrals.newCustomers).toBe(3)
    expect(out.referrals.orders).toHaveLength(3)
    expect(out.tier).toBeNull()
    expect(out.commissionPct).toBe(30)
    // byMonth covers matured + pending months only (paid excluded), sorted.
    const months = out.earnings.byMonth.map((m: { month: string }) => m.month)
    expect(months).toEqual(['2026-05', '2026-06'])
  })

  it('scopes every read to the SESSION creator id — never a client-supplied id', async () => {
    await GET()
    for (const call of db.referralOrder.findMany.mock.calls) {
      expect(call[0].where).toEqual({ referral: { creatorId: 'cr1' } })
    }
    expect(db.referral.count).toHaveBeenCalledWith({ where: { creatorId: 'cr1' } })
  })
})
