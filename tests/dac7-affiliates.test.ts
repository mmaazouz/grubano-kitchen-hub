import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── DAC7 affiliates as a reportable role (Agent 86) ──────────────────────────────
// Affiliates join the DAC7 reportable set with their OWN revenue source: the FROZEN
// commission on matured/paid ReferralOrders (creatorEarning, NET 30 %/40 %), keyed by
// affiliateId (= the affiliate's operator id), bucketed by quarter (createdAt). The
// restaurant aggregation stays byte-identical. READ-ONLY — no money is moved.

const { db } = vi.hoisted(() => ({
  db: {
    operator:      { findMany: vi.fn() },
    restaurant:    { findMany: vi.fn() },
    ledgerEntry:   { findMany: vi.fn() },
    referralOrder: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { aggregateDac7Year, toDac7Csv, DAC7_CONFIG } from '@/lib/dac7'

// affiliate operator identity (same Operator fields used for restaurants + the affiliate Connect acct)
const AFFOP = (over: Record<string, unknown> = {}) => ({
  id: 'aff-op', name: 'Alex Influence', email: 'alex@x', officialName: 'ALEX MEDIA SAS', legalForm: 'SAS',
  siren: '987654321', vatNumber: 'FR987', country: 'FR', registeredAddress: '9 rue Y',
  taxId: 'TIN9', taxIdCountry: 'FR', dateOfBirth: null, sellerType: 'entity',
  affiliateStripeAccountId: 'acct_aff', ...over,
})
const RESTOP = (over: Record<string, unknown> = {}) => ({
  id: 'op1', name: 'Resto Un', email: 'op1@x', officialName: 'Resto Un SARL', legalForm: 'SARL',
  siren: '123456789', vatNumber: 'FR123', country: 'FR', registeredAddress: '1 rue X',
  taxId: 'TIN1', taxIdCountry: 'FR', dateOfBirth: null, sellerType: 'entity', ...over,
})
const RO = (over: Record<string, unknown> = {}) => ({
  affiliateId: 'aff-op', creatorEarning: 30, createdAt: new Date('2026-02-15T10:00:00Z'), ...over,
})

// operator.findMany is called TWICE: by role (restaurant collector) then by id (affiliate identities).
function wireOperators(restaurantOps: unknown[], affiliateOps: unknown[]) {
  db.operator.findMany.mockImplementation((args: { where?: { id?: unknown; role?: unknown } }) =>
    Promise.resolve(args?.where?.id ? affiliateOps : restaurantOps))
}

beforeEach(() => {
  vi.clearAllMocks()
  wireOperators([], [])                              // no restaurant, no affiliate by default
  db.restaurant.findMany.mockResolvedValue([])
  db.ledgerEntry.findMany.mockResolvedValue([])
  db.referralOrder.findMany.mockResolvedValue([])
})

describe('affiliate is a reportable DAC7 role', () => {
  it("'affiliate' is in the reportable set", () => {
    expect(DAC7_CONFIG.reportableRoles).toContain('affiliate')
  })

  it('reads ONLY matured/paid affiliate ReferralOrders inside the year window (read-only)', async () => {
    await aggregateDac7Year(2026)
    const where = db.referralOrder.findMany.mock.calls[0][0].where
    expect(where.affiliateId).toEqual({ not: null })
    expect(where.status).toEqual({ in: ['matured', 'paid'] })
    expect(where.createdAt.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(where.createdAt.lt.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('(a) an earning affiliate is reported with the TRUE source', () => {
  beforeEach(() => {
    wireOperators([], [AFFOP()])
    db.referralOrder.findMany.mockResolvedValue([
      RO({ creatorEarning: 30, createdAt: new Date('2026-02-15T10:00:00Z') }),   // Q1 → 3000¢
      RO({ creatorEarning: 12.5, createdAt: new Date('2026-05-15T10:00:00Z') }), // Q2 → 1250¢
    ])
  })

  it('gross = Σ round(creatorEarning×100), tx count, quarters, identity, no platform fee (net == gross)', async () => {
    const r = await aggregateDac7Year(2026)
    const s = r.sellers.find((x) => x.operatorId === 'aff-op')!
    expect(s.sellerRole).toBe('affiliate')
    expect(s.quarters.Q1.grossConsiderationCents).toBe(3000)
    expect(s.quarters.Q2.grossConsiderationCents).toBe(1250)
    expect(s.quarters.Q3.grossConsiderationCents).toBe(0)
    expect(s.totalGrossConsiderationCents).toBe(4250)
    expect(s.totalNetCreditedCents).toBe(4250)        // commission IS the net cut
    expect(s.totalPlatformFeesCents).toBe(0)          // no fee withheld from the affiliate's commission
    expect(s.totalTransactions).toBe(2)
    expect(s.identity.officialName).toBe('ALEX MEDIA SAS')
    expect(s.identity.siren).toBe('987654321')
    expect(s.identity.financialAccountRefs).toEqual(['acct_aff'])  // the affiliate Connect acct ref
  })

  it('per-row cent rounding matches partner-balance (round each creatorEarning, then sum)', async () => {
    db.referralOrder.findMany.mockResolvedValue([RO({ creatorEarning: 0.30 }), RO({ creatorEarning: 0.07 })])
    const s = (await aggregateDac7Year(2026)).sellers.find((x) => x.operatorId === 'aff-op')!
    expect(s.totalGrossConsiderationCents).toBe(37)   // round(30.0000…)+round(7.0000…) = 30 + 7
  })
})

describe('(b) seuil / perimeter — same logic as the other roles', () => {
  it('no matured/paid affiliate earnings → the affiliate is NOT reported', async () => {
    db.referralOrder.findMany.mockResolvedValue([]) // pending/cancelled rows are not even fetched
    expect((await aggregateDac7Year(2026)).sellers).toHaveLength(0)
    // the identity fetch is skipped entirely when there are no affiliate earnings
    expect(db.operator.findMany.mock.calls.every((c) => !c[0]?.where?.id)).toBe(true)
  })
})

describe('(c) existing restaurant role is byte-identical (no affiliate data)', () => {
  it('a restaurant seller is reported exactly as before, tagged sellerRole=restaurant', async () => {
    wireOperators([RESTOP()], [])
    db.restaurant.findMany.mockResolvedValue([{ id: 'r1', operatorId: 'op1', stripeAccountId: 'acct_1' }])
    db.ledgerEntry.findMany.mockResolvedValue([
      { restaurantId: 'r1', type: 'payment', grossAmount: 1000, applicationFeeAmount: 100, netToRestaurant: 900, createdAt: new Date('2026-02-15T10:00:00Z') },
    ])
    const r = await aggregateDac7Year(2026)
    expect(r.sellers).toHaveLength(1)
    const s = r.sellers[0]
    expect(s.operatorId).toBe('op1')
    expect(s.sellerRole).toBe('restaurant')
    expect(s.totalGrossConsiderationCents).toBe(1000)
    expect(s.totalPlatformFeesCents).toBe(100)
    expect(s.totalNetCreditedCents).toBe(900)
    expect(s.totalTransactions).toBe(1)
  })
})

describe('(f) an operator who is BOTH → two rows (restaurant figures unchanged)', () => {
  it('emits a restaurant row AND an affiliate row for the same operatorId', async () => {
    wireOperators([RESTOP({ id: 'op1' })], [AFFOP({ id: 'op1', email: 'op1@x', affiliateStripeAccountId: 'acct_aff1' })])
    db.restaurant.findMany.mockResolvedValue([{ id: 'r1', operatorId: 'op1', stripeAccountId: 'acct_1' }])
    db.ledgerEntry.findMany.mockResolvedValue([
      { restaurantId: 'r1', type: 'payment', grossAmount: 5000, applicationFeeAmount: 500, netToRestaurant: 4500, createdAt: new Date('2026-02-15T10:00:00Z') },
    ])
    db.referralOrder.findMany.mockResolvedValue([RO({ affiliateId: 'op1', creatorEarning: 20 })]) // 2000¢
    const r = await aggregateDac7Year(2026)
    const resto = r.sellers.find((s) => s.operatorId === 'op1' && s.sellerRole === 'restaurant')!
    const aff = r.sellers.find((s) => s.operatorId === 'op1' && s.sellerRole === 'affiliate')!
    expect(resto.totalGrossConsiderationCents).toBe(5000)   // restaurant figures UNCHANGED
    expect(resto.totalPlatformFeesCents).toBe(500)
    expect(aff.totalGrossConsiderationCents).toBe(2000)
    // sorted by gross desc → restaurant (5000) before affiliate (2000)
    expect(r.sellers.map((s) => `${s.operatorId}:${s.sellerRole}`)).toEqual(['op1:restaurant', 'op1:affiliate'])
  })
})

describe('CSV export carries the affiliate row + sellerRole column', () => {
  it('header has sellerRole; an affiliate row is present', async () => {
    wireOperators([], [AFFOP()])
    db.referralOrder.findMany.mockResolvedValue([RO({ creatorEarning: 40 })])
    const csv = toDac7Csv(await aggregateDac7Year(2026))
    const lines = csv.trimEnd().split('\n')
    expect(lines[1]).toContain('sellerRole')
    expect(lines[1]).toContain('operatorId')
    expect(lines.some((l) => l.includes('aff-op') && l.includes('affiliate'))).toBe(true)
  })
})
