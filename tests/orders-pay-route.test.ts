import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── WP-MONEY-04 (2/2) · POST /api/orders/[id]/pay — charge amount + fee ────────
// composition + ConnectRouting (destination vs platform) + byte-identity-when-OFF.
// Real pure math runs (commission / promotions); Stripe + prisma + the royalty/tip
// writers are mocked. eurosToCents is kept REAL so the amount/fee assertions bite.
// PROBE: tipCents is read ONLY behind isTipsEnabled() (route line 129) — so with
// TIPS OFF the charge/fee are byte-identical even if the column holds a value.

const { db, stripe, getToken, franchise, ledger } = vi.hoisted(() => ({
  db: {
    order:      { findUnique: vi.fn(), update: vi.fn() },
    restaurant: { findUnique: vi.fn() },
  },
  stripe: {
    createTicketPayment: vi.fn(),
    retrieveIntent: vi.fn(),
    cancelIntent: vi.fn(),
    getPublishableKey: vi.fn(() => 'pk_test'),
    eurosToCents: (e: number) => Math.round(e * 100), // REAL — the maths depends on it
  },
  getToken: vi.fn(),
  franchise: { computeFranchiseRoyalty: vi.fn(), recordFranchiseRoyalty: vi.fn() },
  ledger: { recordCourierTipLedgerEntry: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => stripe)
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/franchise-royalty', () => franchise)
vi.mock('@/lib/ledger', () => ledger)
// KEEP REAL: @/lib/commission, @/lib/promotions, @/lib/tips (env-driven)

import { POST } from '@/app/api/orders/[id]/pay/route'

const pay = (id = 'o1') => POST(new NextRequest(`http://x/api/orders/${id}/pay`, { method: 'POST' }), { params: { id } })

// EUR floats on the Order (schema), cents everywhere in the fee math.
const ORDER = {
  id: 'o1', consumerId: 'c1', restaurantId: 'r1', status: 'received',
  subtotal: 100, deliveryFee: 5, total: 105, fulfillmentType: 'delivery',
  stripePaymentIntentId: null, paymentStatus: 'pending', pointOfSaleId: null,
  paymentMethod: 'card', // P0-29: the route now reads + guards the payment mode
  loyaltyCreditCents: 0, smallOrderFeeCents: 0, tipCents: 0,
}
const ROUTED = { stripeAccountId: 'acct_x', stripeAccountStatus: 'active', commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null }
const PLATFORM = { stripeAccountId: null, stripeAccountStatus: null, commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null }
const opts = () => stripe.createTicketPayment.mock.calls[0][0] as any

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockResolvedValue({ sub: 'c1' })
  db.order.findUnique.mockResolvedValue(ORDER)
  db.restaurant.findUnique.mockResolvedValue(ROUTED)
  db.order.update.mockResolvedValue({})
  franchise.computeFranchiseRoyalty.mockResolvedValue({ royaltyCents: 0, franchisorOperatorId: null, pointOfSaleId: null, rate: 0 })
  ledger.recordCourierTipLedgerEntry.mockResolvedValue({ ok: true })
  stripe.createTicketPayment.mockImplementation(async (o: any) => ({
    id: 'pi_new', client_secret: 'cs_123',
    amount: o.amountCents,
    application_fee_amount: o.connect?.applicationFeeCents ?? 0,
    transfer_data: o.connect ? { destination: o.connect.destination } : undefined,
  }))
})
afterEach(() => { delete process.env.TIPS_ENABLED; delete process.env.FRANCHISE_ROYALTY_ENABLED; delete process.env.COMMISSION_BASE })

describe('guards — no Stripe call on any rejected path', () => {
  it('401 no token', async () => { getToken.mockResolvedValue(null); expect((await pay()).status).toBe(401); expect(stripe.createTicketPayment).not.toHaveBeenCalled() })
  it('404 order missing', async () => { db.order.findUnique.mockResolvedValue(null); expect((await pay()).status).toBe(404) })
  it('403 not the owner', async () => { getToken.mockResolvedValue({ sub: 'other' }); expect((await pay()).status).toBe(403); expect(stripe.createTicketPayment).not.toHaveBeenCalled() })
  it('409 already paid', async () => { db.order.findUnique.mockResolvedValue({ ...ORDER, paymentStatus: 'paid' }); expect((await pay()).status).toBe(409) })
  it('400 cancelled', async () => { db.order.findUnique.mockResolvedValue({ ...ORDER, status: 'cancelled' }); expect((await pay()).status).toBe(400) })
  it('400 amount below Stripe minimum', async () => { db.order.findUnique.mockResolvedValue({ ...ORDER, total: 0.3 }); expect((await pay()).status).toBe(400) })
  // P0-29 (vague 2 — Q2/Q8): the card rail refuses any NON-CARD order — closes the
  // legacy double-collection door (cash rows created before P0-02 were card-payable).
  it("⭐ P0-29: 409 payment_method_mismatch on a legacy 'cash' order — no Stripe, no write, attempt traced", async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.order.findUnique.mockResolvedValue({ ...ORDER, paymentMethod: 'cash' })
    const res = await pay()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'payment_method_mismatch' })
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[P0-29]'))
    warnSpy.mockRestore()
  })
})

describe('ROUTED (Connect active) — destination charge + fee on the food base', () => {
  it('delivery, no flags: amount, fee=12% of subtotal, connect + metadata + idempotencyKey', async () => {
    const res = await pay()
    expect(res.status).toBe(201)
    const o = opts()
    expect(o.amountCents).toBe(10500)                                  // eurosToCents(105)
    expect(o.connect).toEqual({ destination: 'acct_x', applicationFeeCents: 1200 }) // round(10000*0.12)
    expect(o.extraMetadata.orderId).toBe('o1')
    expect(o.extraMetadata.grubano_channel).toBe('delivery')
    expect(o.extraMetadata).not.toHaveProperty('courier_tip_cents')
    expect(o.extraMetadata).not.toHaveProperty('franchise_royalty_cents')
    expect(o.idempotencyKey).toBe('orderpay-o1-10500-1200-first')
    // resto net = amount − fee = 9300 (subtotal+delivery − commission)
    expect(o.amountCents - o.connect.applicationFeeCents).toBe(9300)
  })
})

describe('PLATFORM fallback (Connect not active) — no split, whole charge on platform', () => {
  it('no transfer_data / no application_fee when stripeAccountStatus !== active', async () => {
    db.restaurant.findUnique.mockResolvedValue(PLATFORM)
    const res = await pay()
    expect(res.status).toBe(201)
    const o = opts()
    expect(o.connect).toBeUndefined()
    expect(o.amountCents).toBe(10500)
  })
  it('also platform when stripeAccountId is null but status somehow active', async () => {
    db.restaurant.findUnique.mockResolvedValue({ ...ROUTED, stripeAccountId: null })
    await pay()
    expect(opts().connect).toBeUndefined()
  })
})

describe('byte-identity when OFF — the money-safety gate', () => {
  it('TIPS OFF: even if order.tipCents column = 500, the charge/fee are byte-identical (tip gated)', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, tipCents: 500 }) // column has a value…
    await pay()                                                        // …but TIPS_ENABLED is unset
    const o = opts()
    expect(o.amountCents).toBe(10500)
    expect(o.connect.applicationFeeCents).toBe(1200)     // identical to the no-tip baseline
    expect(o.extraMetadata).not.toHaveProperty('courier_tip_cents')
    expect(ledger.recordCourierTipLedgerEntry).not.toHaveBeenCalled()
  })
  it('FRANCHISE_ROYALTY OFF: no royalty in the fee, no franchise metadata, no accrual', async () => {
    await pay()
    expect(opts().connect.applicationFeeCents).toBe(1200)
    expect(franchise.recordFranchiseRoyalty).not.toHaveBeenCalled()
  })
})

describe('TIPS ON — tip held in the application_fee, cancels for the resto', () => {
  it('tip added to fee (not resto net) + metadata + ledger accrual', async () => {
    process.env.TIPS_ENABLED = 'true'
    db.order.findUnique.mockResolvedValue({ ...ORDER, total: 108, tipCents: 300 }) // 105 + 3€ tip
    const res = await pay()
    expect(res.status).toBe(201)
    const o = opts()
    expect(o.amountCents).toBe(10800)
    expect(o.connect.applicationFeeCents).toBe(1500)           // 1200 commission + 300 tip
    expect(o.extraMetadata.courier_tip_cents).toBe('300')
    expect(ledger.recordCourierTipLedgerEntry).toHaveBeenCalledTimes(1)
    // resto net unchanged vs no-tip: 10800 − 1500 = 9300
    expect(o.amountCents - o.connect.applicationFeeCents).toBe(9300)
  })
})

describe('loyalty credit — absorbed by Grubano fee, resto net PLEIN', () => {
  it('credit floors the app fee (grossFee − credit), resto net identical', async () => {
    // total already has the 2€ credit deducted → 103; column reports 200c credit
    db.order.findUnique.mockResolvedValue({ ...ORDER, total: 103, loyaltyCreditCents: 200 })
    await pay()
    const o = opts()
    expect(o.amountCents).toBe(10300)
    expect(o.connect.applicationFeeCents).toBe(1000)       // 1200 − 200 credit
    expect(o.amountCents - o.connect.applicationFeeCents).toBe(9300) // resto still touches plein
  })
})

describe('idempotent reuse', () => {
  it('existing PI already succeeded → 409, no new charge', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, stripePaymentIntentId: 'pi_old' })
    stripe.retrieveIntent.mockResolvedValue({ id: 'pi_old', status: 'succeeded' })
    expect((await pay()).status).toBe(409)
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
  })
})
