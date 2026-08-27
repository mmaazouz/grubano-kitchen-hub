import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P4.3 ÉTAPE 3 — POST /api/orders/[id]/pay · case-B courier withholding ────────────
// Locks: case B (Order.deliveryMode='grubano_courier' + LOGISTICS_COURIER_ACCRUAL_ENABLED
// ON) withholds the FULL deliveryFee in the application_fee (resto net drops by the fee);
// case A ('restaurant') AND flag OFF are BYTE-IDENTICAL to the C0 baseline. Same harness as
// orders-pay-route.test.ts (which stays UNCHANGED = the byte-identical proof for case A).

const { db, stripe, getToken, franchise, ledger } = vi.hoisted(() => ({
  db: { order: { findUnique: vi.fn(), update: vi.fn() }, restaurant: { findUnique: vi.fn() } },
  stripe: {
    createTicketPayment: vi.fn(), retrieveIntent: vi.fn(), cancelIntent: vi.fn(),
    getPublishableKey: vi.fn(() => 'pk_test'), eurosToCents: (e: number) => Math.round(e * 100),
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
// KEEP REAL: @/lib/commission, @/lib/promotions, @/lib/tips, @/lib/courier-accrual (env flag)

import { POST } from '@/app/api/orders/[id]/pay/route'
const pay = (id = 'o1') => POST(new NextRequest(`http://x/api/orders/${id}/pay`, { method: 'POST' }), { params: { id } })

const ORDER = {
  id: 'o1', consumerId: 'c1', restaurantId: 'r1', status: 'received',
  subtotal: 100, deliveryFee: 5, total: 105, fulfillmentType: 'delivery',
  stripePaymentIntentId: null, paymentStatus: 'pending', pointOfSaleId: null,
  paymentMethod: 'card', // P0-29: the route now reads + guards the payment mode
  loyaltyCreditCents: 0, smallOrderFeeCents: 0, tipCents: 0, deliveryMode: 'restaurant',
}
const ROUTED = { stripeAccountId: 'acct_x', stripeAccountStatus: 'active', commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null }
const opts = () => stripe.createTicketPayment.mock.calls[0][0] as any

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED
  delete process.env.LOGISTICS_COMMISSION_BPS
  getToken.mockResolvedValue({ sub: 'c1' })
  db.order.findUnique.mockResolvedValue(ORDER)
  db.restaurant.findUnique.mockResolvedValue(ROUTED)
  db.order.update.mockResolvedValue({})
  franchise.computeFranchiseRoyalty.mockResolvedValue({ royaltyCents: 0, franchisorOperatorId: null, pointOfSaleId: null, rate: 0 })
  ledger.recordCourierTipLedgerEntry.mockResolvedValue({ ok: true })
  stripe.createTicketPayment.mockImplementation(async (o: any) => ({
    id: 'pi_new', client_secret: 'cs',
    amount: o.amountCents, application_fee_amount: o.connect?.applicationFeeCents ?? 0,
    transfer_data: o.connect ? { destination: o.connect.destination } : undefined,
  }))
})
afterEach(() => { delete process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED; delete process.env.LOGISTICS_COMMISSION_BPS })

describe('case B — grubano_courier withholds the deliveryFee in the application_fee', () => {
  it('flag ON + grubano_courier: fee = commission + FULL deliveryFee; resto net drops by the fee', async () => {
    process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED = 'true'
    db.order.findUnique.mockResolvedValue({ ...ORDER, deliveryMode: 'grubano_courier' })
    const res = await pay()
    expect(res.status).toBe(201)
    const o = opts()
    expect(o.amountCents).toBe(10500)                    // client pays the SAME total
    expect(o.connect.applicationFeeCents).toBe(1700)     // 1200 commission + 500 deliveryFee held
    expect(o.extraMetadata.courier_withheld_cents).toBe('500')
    // resto net = amount − fee = 8800 = subtotal 10000 − commission 1200 (delivery withheld)
    expect(o.amountCents - o.connect.applicationFeeCents).toBe(8800)
  })
})

describe('byte-identity — case A / flag OFF (the money-safety gate)', () => {
  it('flag ON but deliveryMode=restaurant → BYTE-IDENTICAL (fee 1200, resto net 9300, no metadata)', async () => {
    process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED = 'true' // rail ON…
    await pay()                                            // …but a case-A order → no withholding
    const o = opts()
    expect(o.connect.applicationFeeCents).toBe(1200)
    expect(o.amountCents - o.connect.applicationFeeCents).toBe(9300)
    expect(o.extraMetadata).not.toHaveProperty('courier_withheld_cents')
  })

  it('flag OFF even with a grubano_courier column → BYTE-IDENTICAL (gated: deliveryMode not read)', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, deliveryMode: 'grubano_courier' }) // column says case B…
    await pay()                                                                          // …but the flag is OFF
    const o = opts()
    expect(o.connect.applicationFeeCents).toBe(1200)
    expect(o.amountCents - o.connect.applicationFeeCents).toBe(9300)
    expect(o.extraMetadata).not.toHaveProperty('courier_withheld_cents')
  })
})

describe('case B — platform fallback (QA : ALLOW_PLATFORM_FALLBACK) → no split', () => {
  it('grubano_courier + inactive Connect → no connect object, whole charge on Grubano', async () => {
    process.env.ALLOW_PLATFORM_FALLBACK = 'true'
    process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED = 'true'
    db.order.findUnique.mockResolvedValue({ ...ORDER, deliveryMode: 'grubano_courier' })
    db.restaurant.findUnique.mockResolvedValue({ ...ROUTED, stripeAccountId: null })
    await pay()
    expect(opts().connect).toBeUndefined()
    delete process.env.ALLOW_PLATFORM_FALLBACK
  })
})

describe('case B — the WITHHELD is the FULL fee (the 20% split happens at accrual, not at pay)', () => {
  it('LOGISTICS_COMMISSION_BPS does not change the withheld amount (full deliveryFee held)', async () => {
    process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED = 'true'
    process.env.LOGISTICS_COMMISSION_BPS = '3000' // 30% commission at accrual…
    db.order.findUnique.mockResolvedValue({ ...ORDER, deliveryMode: 'grubano_courier' })
    await pay()
    expect(opts().connect.applicationFeeCents).toBe(1700) // …still holds the FULL 500 here
    expect(opts().extraMetadata.courier_withheld_cents).toBe('500')
  })
})
