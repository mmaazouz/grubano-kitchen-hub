import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── INF-3 (Phase 6) — VERIFIED-affiliate (influencer) commission uplift in the order path ─
// A base affiliate earns the global ReferralConfig.commissionPctOfGrubanoFee (30 %) of the
// NET pot; a VERIFIED affiliate (influencer tier — Affiliate.audienceVerified) earns the
// higher ReferralConfig.influencerCommissionPct (40 %) of the SAME pot. The uplift is read
// at order time ONLY when INFLUENCER_ENABLED is ON and the order's ACCRUAL recipient
// (ref.referringAffiliateId — the first-touch-bound affiliate, NOT necessarily the code's)
// is verified. It is NEVER applied to a creator, never to an unverified affiliate, and is
// fully off when the flag is OFF (byte-identical, no extra query). The resolved rate is
// FROZEN into the ReferralOrder → non-retroactive. The charge / Grubano commission are
// untouched. These tests exercise the REAL lib/influencer-verification (prisma + env mocked)
// so the whole chain audienceVerified → rate → frozen creatorEarning is proven end-to-end.
// Mocks mirror orders-affiliate-attribution.test.ts (Brique B).

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:     { findFirst: vi.fn(), findUnique: vi.fn() },
    creator:        { findFirst: vi.fn() },
    // findFirst → resolve an affiliate by referralCode (5B). findUnique → isAffiliateVerified
    // (by operatorId) reads audienceVerified. Both on the same model, distinct call sites.
    affiliate:      { findFirst: vi.fn(), findUnique: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    referral:       { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralOrder:  { findUnique: vi.fn(), create: vi.fn() },
    order:          { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    promotion:      { findMany: vi.fn() },
    dishAdoption:   { findMany: vi.fn() },
    dishSale:       { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:    { update: vi.fn() },
    adoptionConfig: { findFirst: vi.fn() },
    openingHour:       { findMany: vi.fn() },
    closureException:  { findMany: vi.fn() },
    ledgerEntry:    { create: vi.fn(), findMany: vi.fn() },
    loyaltyCustomer: { updateMany: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST as createOrder } from '@/app/api/orders/route'

const makeReq = (body: Record<string, unknown>) =>
  new NextRequest('https://app.grubano.com/api/orders', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
const orderBody = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'rest1',
  items: [{ itemId: 'i1', name: 'Dish', qty: 1, price: 20, options: [] }],
  deliveryAddress: '12 rue de la Paix',
  paymentMethod: 'card',
  fulfillmentType: 'delivery',
  referralCode: 'CODE1',
  ...over,
})

// Both flags must be ON for the uplift: AFFILIATE_ENABLED gates the affiliate resolution,
// INFLUENCER_ENABLED gates the uplift itself.
const AFF_ON  = () => { process.env.AFFILIATE_ENABLED = 'true' }
const INF_ON  = () => { process.env.INFLUENCER_ENABLED = 'true' }
const ALL_OFF = () => { delete process.env.AFFILIATE_ENABLED; delete process.env.INFLUENCER_ENABLED }

const refOrderData = () => (db.referralOrder.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data
const orderData    = () => (db.order.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data

function arm() {
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'consumer' })
  db.restaurant.findFirst.mockResolvedValue({
    id: 'rest1', isActive: true, deliveryFee: 0, minOrder: 5, pointOfSaleId: null,
    commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null,
  })
  db.openingHour.findMany.mockResolvedValue([])
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null)
  // The code resolves to an UNVERIFIED affiliate by default; verification is per-test.
  db.affiliate.findFirst.mockResolvedValue({ id: 'a1', operatorId: 'aff-op', referralCode: 'CODE1' })
  db.affiliate.findUnique.mockResolvedValue({ audienceVerified: false })
  db.referralConfig.findFirst.mockResolvedValue({
    commissionPctOfGrubanoFee: 0.30, influencerCommissionPct: 0.40,
    newCustomerBonusAmount: 0, durationDays: 90, customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
  })
  db.referral.findFirst.mockResolvedValue(null)               // CAS 1 by default
  db.referralOrder.findUnique.mockResolvedValue(null)
  db.referralOrder.create.mockResolvedValue({ id: 'ro1' })
  db.referral.create.mockResolvedValue({ id: 'refb1' })
  db.promotion.findMany.mockResolvedValue([])
  db.dishAdoption.findMany.mockResolvedValue([])
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 20, status: 'received' })
  db.order.updateMany.mockResolvedValue({ count: 1 })
  db.order.count.mockResolvedValue(0)
}

beforeEach(() => { vi.clearAllMocks(); ALL_OFF(); arm() })
afterEach(() => { ALL_OFF() })

// Earning helper: capture the frozen creatorEarning written to the ReferralOrder.
const earning = () => refOrderData().creatorEarning as number

describe('INF-3 — verified-affiliate commission uplift (order-time, frozen, gated)', () => {
  it('(a) VERIFIED affiliate + both flags ON → accrual frozen at influencerCommissionPct (40 %)', async () => {
    AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    // subtotal 20, delivery 0 → gross 240c; net = 240 − stripe(round(2000×0.029)+25=83) = 157c.
    // verified → round2(1.57 × 0.40) = 0.63 (vs base round2(1.57 × 0.30) = 0.47).
    expect(refOrderData().affiliateId).toBe('aff-op')
    expect(earning()).toBeCloseTo(0.63, 2)
    // verification was checked on the ACCRUAL recipient (operator id)
    expect(db.affiliate.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { operatorId: 'aff-op' } }))
  })

  it('(b) base affiliate (NOT verified) + both flags ON → base 30 %, uplift NOT applied', async () => {
    AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: false })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(earning()).toBeCloseTo(0.47, 2) // round2(1.57 × 0.30)
  })

  it('(c) creator code + INFLUENCER_ENABLED ON → uplift NEVER applies; verification NOT queried', async () => {
    AFF_ON(); INF_ON()
    db.creator.findFirst.mockResolvedValue({ id: 'cr1', email: 'creator@x.com', referralCode: 'CODE1' })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    // creator accrual: base 30 %, no affiliateId, and isAffiliateVerified (findUnique) untouched
    expect(refOrderData().affiliateId).toBeUndefined()
    expect(earning()).toBeCloseTo(0.47, 2)
    expect(db.affiliate.findUnique).not.toHaveBeenCalled()
  })

  it('(d) INFLUENCER_ENABLED OFF + verified affiliate → byte-identical base 30 %, NO extra query', async () => {
    AFF_ON() // affiliate resolution ON, influencer uplift OFF
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(earning()).toBeCloseTo(0.47, 2)
    // flag-OFF guarantee: the verification read never fires (short-circuit before any I/O)
    expect(db.affiliate.findUnique).not.toHaveBeenCalled()
  })

  it('(e) CHARGE + Grubano commission unchanged between verified-40 % and base-30 %', async () => {
    // verified run
    AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    await createOrder(makeReq(orderBody()))
    const vCharge = orderData().total
    const vFee    = refOrderData().grubanoFee as number
    const vEarn   = earning()
    // base run (fresh, unverified)
    vi.clearAllMocks(); ALL_OFF(); arm(); AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: false })
    await createOrder(makeReq(orderBody()))
    const bCharge = orderData().total
    const bFee    = refOrderData().grubanoFee as number
    const bEarn   = earning()
    // ONLY the reversed share moves; the customer charge + Grubano fee are identical.
    expect(vCharge).toBe(bCharge)
    expect(vCharge).toBe(20) // no welcome discount on the affiliate rail
    expect(vFee).toBe(bFee)
    expect(vEarn).toBeGreaterThan(bEarn) // 0.63 > 0.47
  })

  it('(f) the influencer rate is FROZEN from the ACTIVE config (param respected, not hardcoded 0.40)', async () => {
    AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    db.referralConfig.findFirst.mockResolvedValue({
      commissionPctOfGrubanoFee: 0.30, influencerCommissionPct: 0.50, // Mohammed sets 50 %
      newCustomerBonusAmount: 0, durationDays: 90, customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
    })
    await createOrder(makeReq(orderBody()))
    expect(earning()).toBeCloseTo(0.79, 2) // round2(1.57 × 0.50) = 0.785 → 0.79
  })

  it('(g) CAS 2 first-touch — uplift follows the BOUND affiliate, not the code holder', async () => {
    AFF_ON(); INF_ON()
    // The code resolves to UNVERIFIED 'aff-op', but the customer is already first-touch bound
    // to a DIFFERENT, VERIFIED affiliate 'affA' (open window). The accrual + the rate must
    // follow 'affA' (first-touch wins), so the uplift applies even though the code holder is
    // not verified.
    db.referral.findFirst.mockResolvedValue({
      id: 'refExisting', affiliateId: 'affA', creatorId: null, active: true,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    })
    db.affiliate.findUnique.mockImplementation(({ where }: { where: { operatorId: string } }) =>
      Promise.resolve({ audienceVerified: where.operatorId === 'affA' }))
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(refOrderData().affiliateId).toBe('affA')        // accrual to the bound affiliate
    expect(refOrderData().referralId).toBe('refExisting')  // binding reused
    expect(db.affiliate.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { operatorId: 'affA' } }))
    expect(earning()).toBeCloseTo(0.63, 2)                 // verified rate (affA), not the code holder's
  })

  it('(h) verified affiliate but expired window → no accrual, verification NOT queried', async () => {
    AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    db.referral.findFirst.mockResolvedValue({
      id: 'refOld', affiliateId: 'aff-op', creatorId: null, active: true,
      expiresAt: new Date(Date.now() - 86_400_000), // expired → no payout
    })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(db.referralOrder.create).not.toHaveBeenCalled()
    // ref.referringAffiliateId stays null on an expired window → short-circuit, no verify read
    expect(db.affiliate.findUnique).not.toHaveBeenCalled()
  })

  it('(i) isAffiliateVerified throws → checkout SURVIVES, accrual frozen at BASE rate (fail-safe)', async () => {
    AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockRejectedValue(new Error('verification DB down'))
    const res = await createOrder(makeReq(orderBody()))
    // the referral-resolution try/catch swallows the throw; the order still completes and the
    // affiliate accrual is still written, frozen at the BASE 30 % (the uplift line never ran).
    expect(res.status).toBe(201)
    expect(db.referralOrder.create).toHaveBeenCalled()
    expect(refOrderData().affiliateId).toBe('aff-op')
    expect(earning()).toBeCloseTo(0.47, 2) // base rate — no uplift, no corruption
  })

  it('(j) loyalty cap INVARIANT — verified vs base give the SAME loyalty credit; only the accrual moves', async () => {
    // The applied loyalty credit lands on the order.update carrying loyaltyCreditCents.
    const creditUpdate = () =>
      (db.order.update.mock.calls.find(c => 'loyaltyCreditCents' in (((c[0] as { data?: Record<string, unknown> })?.data) ?? {}))?.[0] as { data: Record<string, unknown> })?.data
    // verified run, points used
    AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    db.loyaltyCustomer.findUnique.mockResolvedValue({ id: 'lc1', pointsBalance: 10_000 })
    await createOrder(makeReq(orderBody({ usePoints: true })))
    const vCredit = creditUpdate(); const vEarn = earning()
    // base run, points used (fresh)
    vi.clearAllMocks(); ALL_OFF(); arm(); AFF_ON(); INF_ON()
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: false })
    db.loyaltyCustomer.findUnique.mockResolvedValue({ id: 'lc1', pointsBalance: 10_000 })
    await createOrder(makeReq(orderBody({ usePoints: true })))
    const bCredit = creditUpdate(); const bEarn = earning()
    // The loyalty credit is driven by committedClaims; affiliationCents is creator-gated → 0
    // for an affiliate, so it is INDEPENDENT of the commission rate → identical both runs.
    expect(vCredit).toBeDefined()
    expect(vCredit.loyaltyCreditCents).toBe(bCredit.loyaltyCreditCents)
    expect(vCredit.total).toBe(bCredit.total)
    expect(vEarn).toBeGreaterThan(bEarn) // only the affiliate accrual moves (0.63 > 0.47)
  })
})
