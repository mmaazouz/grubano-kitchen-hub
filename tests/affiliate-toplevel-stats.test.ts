import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/affiliate/stats — TOP-LEVEL affiliate dashboard feed (Brique C, Agent 60) ──
// Operator-keyed twin of the creator route. The affiliate is resolved from the
// SESSION operator id (never a client value → IDOR-safe), gated by AFFILIATE_ENABLED
// (404 when OFF), READ-ONLY. Reuses the REAL pure gamification lib (affiliate-status)
// + a mocked balance/clicks. Asserts owner-scoping, the click→conversion funnel and a
// privacy-safe leaderboard (rank+name+tier only — never others' €).

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { enabledMock, affMock } = vi.hoisted(() => ({ enabledMock: vi.fn(), affMock: vi.fn() }))
vi.mock('@/lib/affiliate-account', () => ({
  isAffiliateEnabled:   enabledMock,
  getAffiliateByOperator: affMock,
}))

const { balanceMock } = vi.hoisted(() => ({ balanceMock: vi.fn() }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: balanceMock }))

const { clicksMock } = vi.hoisted(() => ({ clicksMock: vi.fn() }))
vi.mock('@/lib/affiliate-clicks', () => ({ countAffiliateClicks: clicksMock }))

const { db } = vi.hoisted(() => ({
  db: {
    referralOrder:  { findMany: vi.fn() },
    referral:       { count: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    operator:       { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { GET } from '@/app/api/affiliate/stats/route'

const OP_ID = 'op1'
const AFFILIATE = { operatorId: OP_ID, referralCode: 'NABIL30', referralLinkSlug: 'nabil30', status: 'active' }

// Personal referral orders for THIS affiliate (refAll / refRecent).
const PERSONAL = [
  { id: 'ro1', status: 'matured', creatorEarning: 1.00, newCustomerBonus: 0.50,
    createdAt: new Date('2026-05-10T10:00:00Z'), maturedAt: new Date('2026-05-17T10:00:00Z'),
    grubanoFee: 3.6, order: { total: 20, createdAt: new Date('2026-05-10T10:00:00Z'), restaurant: { name: 'R1' } } },
  { id: 'ro2', status: 'pending', creatorEarning: 0.50, newCustomerBonus: 0,
    createdAt: new Date('2026-06-02T10:00:00Z'), maturedAt: null,
    grubanoFee: 1.8, order: { total: 10, createdAt: new Date('2026-06-02T10:00:00Z'), restaurant: { name: 'R2' } } },
]
// Cross-affiliate matured rows for the leaderboard (op2 outranks op1).
const BOARD = [
  { affiliateId: 'op1', creatorEarning: 1.00, newCustomerBonus: 0.50 },
  { affiliateId: 'op2', creatorEarning: 3.00, newCustomerBonus: 0 },
]

beforeEach(() => {
  vi.clearAllMocks()
  enabledMock.mockReturnValue(true)
  sessionMock.mockResolvedValue({ user: { id: OP_ID } })
  affMock.mockResolvedValue(AFFILIATE)
  balanceMock.mockResolvedValue({ availableCents: 150, paidCents: 0, earnedCents: 150 })
  clicksMock.mockResolvedValue(10)
  db.referral.count.mockResolvedValue(2)
  db.referralConfig.findFirst.mockResolvedValue({ commissionPctOfGrubanoFee: 0.30 })
  db.operator.findMany.mockResolvedValue([{ id: 'op1', name: 'Me' }, { id: 'op2', name: 'Other' }])
  db.referralOrder.findMany.mockImplementation((args: { where?: { status?: string } }) =>
    args?.where?.status === 'matured' ? Promise.resolve(BOARD) : Promise.resolve(PERSONAL),
  )
})

describe('flag + auth gates', () => {
  it('AFFILIATE_ENABLED OFF → 404, no session/DB touched', async () => {
    enabledMock.mockReturnValue(false)
    const res = await GET()
    expect(res.status).toBe(404)
    expect(sessionMock).not.toHaveBeenCalled()
    expect(db.referralOrder.findMany).not.toHaveBeenCalled()
  })

  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('no affiliate profile → 404', async () => {
    affMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(404)
  })
})

describe('aggregation + funnel + balance (operator-keyed)', () => {
  it('splits matured vs pending (cents), exposes balance + click→conversion funnel', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.enabled).toBe(true)
    expect(out.earnings.maturedCents).toBe(150)   // 1.00 + 0.50 bonus
    expect(out.earnings.pendingCents).toBe(50)    // 0.50
    // balance is the AUTHORITATIVE value from computePartnerBalance (not recomputed).
    expect(out.balance.availableCents).toBe(150)
    expect(out.payout.claimableCents).toBe(150)
    expect(out.payout.status).toBe('activation_pending')
    // Funnel: 2 conversions over 10 clicks → 20 %.
    expect(out.clicks.total).toBe(10)
    expect(out.clicks.conversions).toBe(2)
    expect(out.clicks.conversionRatePct).toBe(20)
    expect(out.referrals.newCustomers).toBe(2)
    expect(out.commissionPct).toBe(30)
    // Gamification (real pure lib): 150 c → bronze, firstSale achieved.
    expect(out.tier).toMatchObject({ key: 'bronze' })
    expect(typeof out.streak.weeks).toBe('number')
    expect(out.badges.find((b: { key: string }) => b.key === 'firstSale')?.achieved).toBe(true)
  })

  it('balance is read, not recomputed → uses computePartnerBalance("affiliate", operatorId)', async () => {
    await GET()
    expect(balanceMock).toHaveBeenCalledWith('affiliate', OP_ID)
  })

  it('clicks of 0 → conversionRatePct is 0 (no divide-by-zero)', async () => {
    clicksMock.mockResolvedValue(0)
    const out = await (await GET()).json()
    expect(out.clicks.total).toBe(0)
    expect(out.clicks.conversionRatePct).toBe(0)
  })
})

describe('owner-scoping (IDOR-safe)', () => {
  it('personal reads are keyed on the SESSION operator id; leaderboard query is not', async () => {
    await GET()
    const personal = db.referralOrder.findMany.mock.calls.filter(
      c => (c[0].where as { affiliateId?: unknown }).affiliateId === OP_ID,
    )
    expect(personal.length).toBeGreaterThan(0)
    expect(db.referral.count).toHaveBeenCalledWith({ where: { affiliateId: OP_ID } })
    // The leaderboard query filters on status:matured (cross-affiliate), NOT op-scoped.
    const board = db.referralOrder.findMany.mock.calls.find(c => (c[0].where as { status?: string }).status === 'matured')
    expect(board).toBeTruthy()
    expect((board![0].where as { affiliateId?: unknown }).affiliateId).toEqual({ not: null })
  })
})

describe('privacy-safe leaderboard', () => {
  it('ranks across affiliates, exposes rank+name+tier only (never others € amounts)', async () => {
    const out = await (await GET()).json()
    expect(out.leaderboard).not.toBeNull()
    expect(Array.isArray(out.leaderboard.top)).toBe(true)
    // op2 (300 c) outranks op1 (150 c).
    expect(out.leaderboard.top[0]).toMatchObject({ rank: 1, name: 'Other' })
    const me = out.leaderboard.top.find((e: { isMe: boolean }) => e.isMe)
    expect(me).toMatchObject({ name: 'Me' })
    // NO euro/cent field may leak for any entry.
    for (const e of out.leaderboard.top) {
      expect(Object.keys(e).sort()).toEqual(['isMe', 'name', 'rank', 'tierKey'])
    }
  })
})
