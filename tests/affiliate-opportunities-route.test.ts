import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── GET /api/creator/affiliate-opportunities — Brief du jour 2d (Agent 14) ─────
// Session-aware (email, never ?creatorId), isInfluencer-gated, READ-ONLY heuristic
// (no LLM). The pure ranker/estimator run for real; prisma + session are mocked.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: {
    creator:        { findUnique: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    promotion:      { findMany: vi.fn() },
    referralOrder:  { findMany: vi.fn() },
    restaurant:     { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { GET } from '@/app/api/creator/affiliate-opportunities/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

const CREATOR = { id: 'cr1', isChef: true, isInfluencer: true }

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'creator@example.com' } })
  db.creator.findUnique.mockResolvedValue(CREATOR)
  db.referralConfig.findFirst.mockResolvedValue({ commissionPctOfGrubanoFee: 0.30 })
  db.promotion.findMany
    .mockResolvedValueOnce([ // campaign promos
      { discount: 20, conditions: { itemIds: ['m1'] },
        brand: { restaurantId: 'rA', restaurant: { name: 'Resto A' } },
        campaign: { creatorDish: { name: 'Plat A' }, creator: { name: 'Chef Marco' } } },
    ])
    .mockResolvedValueOnce([ // plain percent promos
      { discount: 15, conditions: { itemIds: ['m2'] }, brand: { restaurantId: 'rB', restaurant: { name: 'Resto B' } } },
    ])
  db.referralOrder.findMany.mockResolvedValue([
    { order: { restaurantId: 'rC', restaurant: { name: 'Resto C' } } },
    { order: { restaurantId: 'rC', restaurant: { name: 'Resto C' } } },
  ])
  db.restaurant.findMany.mockResolvedValue([{ id: 'rD', name: 'Resto D' }, { id: 'rA', name: 'Resto A' }])
})

describe('auth + gating', () => {
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('no creator → 404', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(404)
  })
  it('non-influencer → empty, locked', async () => {
    db.creator.findUnique.mockResolvedValue({ ...CREATOR, isInfluencer: false })
    const out = await (await GET()).json()
    expect(out.isInfluencer).toBe(false)
    expect(out.opportunities).toEqual([])
    expect(db.promotion.findMany).not.toHaveBeenCalled() // no source queries when locked
  })
})

describe('ranking + estimate', () => {
  it('returns ≤3 ranked, deduped opportunities, each with the display estimate', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const out = await res.json()

    expect(out.opportunities).toHaveLength(3)               // rA(campaign), rB(promo), rC(converted); rD dropped, rA deduped
    expect(out.opportunities.map((o: { kind: string }) => o.kind)).toEqual(['campaign', 'promo', 'converted'])

    const camp = out.opportunities[0]
    expect(camp.restaurantName).toBe('Resto A')
    expect(camp.dishId).toBe('m1')
    expect(camp.dishName).toBe('Plat A')
    expect(camp.reasonKey).toBe('oppReasonCampaign')
    expect(camp.reasonParams).toEqual({ creator: 'Chef Marco', pct: 20 })

    expect(out.opportunities[1].reasonParams).toEqual({ pct: 15 })

    // The display estimate (real read-only helpers): 73 c on a 30 € delivery order.
    expect(out.estimatedGainCents).toBe(73)
    for (const o of out.opportunities) expect(o.estimatedGainCents).toBe(73)
  })

  it('tolerates a missing campaign source (pre-db-push) — still returns from other sources', async () => {
    db.promotion.findMany.mockReset()
    db.promotion.findMany
      .mockRejectedValueOnce(new Error('CreatorCampaign table missing')) // campaign query throws
      .mockResolvedValueOnce([]) // no plain promos
    const out = await (await GET()).json()
    // converted (rC) + popular (rD, rA) survive.
    expect(out.opportunities.length).toBeGreaterThan(0)
    expect(out.opportunities[0].kind).toBe('converted')
  })
})
