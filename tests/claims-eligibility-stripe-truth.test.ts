// tests/claims-eligibility-stripe-truth.test.ts — CLAIMS batch 2, audit fix
//
// The ceiling the CUSTOMER is shown and the ceiling the SERVER enforces have to be the same
// number. Batch 2 taught `buildClaimScope` to consult live Stripe truth so a refund issued
// from the Stripe Dashboard (which the rail's own Refund table never sees) still shrinks what
// a claim may ask for — but `getClaimEligibility`, the one call the help page actually makes,
// never passed the PaymentIntent. It therefore kept computing the DB-only ceiling, offered
// the customer money that was already refunded, and let them file a claim the server would
// then refuse. A promise the product cannot keep is the defect, even when no money moves.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    order:  { findUnique: vi.fn() },
    claim:  { findFirst: vi.fn() },
    refund: { aggregate: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { getClaimEligibility } from '@/lib/claims'

const ORDER = {
  consumerId: 'u1',
  paymentStatus: 'paid',
  total: 20,                       // 2000 c
  updatedAt: new Date(),
  items: [{ itemId: 'i1', name: 'Gnocchi', qty: 2, price: 10 }],
  stripePaymentIntentId: 'pi_test',
}

const charge = (amountRefunded: number) => ({
  id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: amountRefunded,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findUnique.mockResolvedValue({ ...ORDER })
  db.claim.findFirst.mockResolvedValue(null)
  // The rail knows about NOTHING: this is the whole point — the refund was issued elsewhere.
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  stripeMock.refunds.list.mockResolvedValue({ data: [] })
})

describe('AUDIT FIX — the ceiling shown to the customer is the ceiling the server enforces', () => {
  it('a refund issued from the Stripe DASHBOARD shrinks the offered ceiling', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(1500) })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.maxRefundableCents).toBe(500)   // 2000 captured − 1500 already refunded
    expect(e.scope?.maxAuthorityCents).toBe(500)
  })

  it('the PaymentIntent is actually read — the fix is not a comment', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(0) })
    await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_test', { expand: ['latest_charge'] })
  })

  it('an order refunded IN FULL outside the rail offers nothing at all', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(2000) })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.maxRefundableCents).toBe(0)
  })

  it('Stripe unreachable → FAIL-SOFT to the DB ceiling, never a crash and never a 0', async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('network'))
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.maxRefundableCents).toBe(2000)
    expect(e.canClaim).toBe(true)
  })

  it('a NON-owner still learns nothing — no order data, and no Stripe call at all', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, consumerId: 'someone-else' })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e).toMatchObject({ canClaim: false, reason: 'not_owner', maxRefundableCents: 0 })
    expect(e.scope).toBeUndefined()
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('DB and Stripe disagree → the SMALLER ceiling wins in the consumer view too', async () => {
    db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 1800 } }) // rail refund Stripe has not settled
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(0) })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.maxRefundableCents).toBe(200)
  })

  // ── NEGATIVE CONTROL ──────────────────────────────────────────────────────────
  it('the pre-fix rule (DB only) would have offered the whole order on a dashboard-refunded one', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(1500) })
    const dbOnlyCeiling = 2000 - 0 // total minus the rail's own (empty) Refund table
    expect(dbOnlyCeiling).toBe(2000) // ← what the customer used to be shown
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.maxRefundableCents).toBe(500) // ← fixed
  })
})
