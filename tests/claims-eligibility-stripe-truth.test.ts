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
    // ROUND 13 (J-C05, slice W7): the status wiring reads the bound row and its binder count.
    claim:  { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { aggregate: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { getClaimEligibility, listConsumerClaims } from '@/lib/claims'
import { MARKERS, customerClaimStatus } from '@/lib/claim-action-rules'

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

// ══ ROUND 13 (slice W7) — J-C05 (F03, F04, F08): the customer status wiring of getClaimEligibility and listConsumerClaims ══
describe('J-C05 — getClaimEligibility and listConsumerClaims wire the customer status', () => {
  const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf1…`
  const EXISTING = (o: Record<string, unknown> = {}) => ({
    id: 'cl1', status: 'refunded', decidedAt: null, restaurantResponseReason: null, arbitrationReason: null, refundError: null, refundId: 'rf1',
    refundAttempted: true, arbitrationDecision: 'approved', restaurantResponse: null, reason: 'wrong_item', ...o,
  })
  const ROW = (status: string) => ({ id: 'rf1', orderId: 'o1', status, amountCents: 500 })

  beforeEach(() => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(500) })
    for (const m of [db.claim.findFirst, db.claim.findMany, db.claim.count, db.claim.groupBy, db.refund.findUnique, db.refund.findMany]) m.mockReset()
    db.claim.count.mockResolvedValue(1)
  })

  it('statuses in order: refunded, refund_unconfirmed, manual check (read throw), manual check (two binders), closed_by_support, manual check (REVERTED)', async () => {
    // Each run resets the three reads: a read a scenario never makes must not leak its queued answer into the next one.
    const run = async (existing: Record<string, unknown>, row: () => Promise<unknown>, binders = 1) => {
      db.claim.findFirst.mockReset().mockResolvedValue(existing)
      db.refund.findUnique.mockReset().mockImplementation(row)
      db.claim.count.mockReset().mockResolvedValue(binders)
      return (await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status
    }
    const statuses = [
      await run(EXISTING(), async () => ROW('succeeded')),
      await run(EXISTING(), async () => ROW('failed')),
      await run(EXISTING(), async () => { throw new Error('db down') }),
      await run(EXISTING(), async () => ROW('succeeded'), 2),
      await run(EXISTING({ refundError: 'engine_failed: x' }), async () => ROW('succeeded')),
      await run(EXISTING({ refundError: REVERTED }), async () => ROW('succeeded')),
    ]
    expect(statuses).toEqual(['refunded', 'refund_unconfirmed', 'financial_verification', 'financial_verification', 'closed_by_support', 'financial_verification'])
  })

  // W7 fixer (ER-C22): binders are counted by refundId even when the row is missing, as listConsumerClaims, the closure sender
  // and the H10 lists count them. BREAK/RESTORE: `row ? count : 0` in getClaimEligibility → the two-binder case reads RUc, red.
  it('a missing bound row: one binder → refund_unconfirmed; two binders → manual check, and listConsumerClaims agrees', async () => {
    const run = async (binders: number) => {
      db.claim.findFirst.mockReset().mockResolvedValue(EXISTING())
      db.refund.findUnique.mockReset().mockResolvedValue(null)
      db.claim.count.mockReset().mockResolvedValue(binders)
      const status = (await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status
      expect(db.claim.count, `binders ${binders}`).toHaveBeenCalledTimes(1)
      expect(db.claim.count.mock.calls[0][0].where.refundId).toBe('rf1')
      return status
    }
    expect([await run(1), await run(2)]).toEqual(['refund_unconfirmed', 'financial_verification'])
    db.claim.findMany.mockReset().mockResolvedValue([{ ...EXISTING({ id: 'a' }), orderId: 'o1', consumerId: 'u1' }, { ...EXISTING({ id: 'b' }), orderId: 'o1', consumerId: 'u1' }])
    db.refund.findMany.mockReset().mockResolvedValue([])
    db.claim.groupBy.mockReset().mockResolvedValue([{ refundId: 'rf1', _count: { _all: 2 } }])
    expect((await listConsumerClaims('u1')).map((c) => c.status)).toEqual(['financial_verification', 'financial_verification'])
  })

  it('in the REVERTED scenario canClaim is true inside the window; the eligibility select carries restaurantResponse, reason and arbitrationReason', async () => {
    db.claim.findFirst.mockResolvedValue(EXISTING({ refundError: REVERTED }))
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.canClaim).toBe(true)
    expect(e.existingClaim?.status).toBe('financial_verification')
    expect(db.claim.findFirst.mock.calls[0][0].select).toMatchObject({ restaurantResponse: true, reason: true, arbitrationReason: true })
  })

  it('a declaration with arbitrationReason « NOTE INTERNE » → the payload carries arbitrationReason null', async () => {
    db.claim.findFirst.mockResolvedValue(EXISTING({ refundError: 'engine_failed: x', arbitrationReason: 'NOTE INTERNE' }))
    db.refund.findUnique.mockResolvedValue(ROW('succeeded'))
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.existingClaim).toMatchObject({ status: 'closed_by_support', arbitrationReason: null })
  })

  it('listConsumerClaims: one refund.findMany and one claim.groupBy per page; hidden fields absent; a findMany throw → FV for refunded kinds only', async () => {
    const claims = [
      { ...EXISTING({ id: 'a' }), orderId: 'o1', consumerId: 'u1', activeOrderKey: null, arbitratedBy: 'op1' },
      { ...EXISTING({ id: 'd', status: 'restaurant_review', refundId: null, refundAttempted: false, arbitrationDecision: null }), orderId: 'o1', consumerId: 'u1', activeOrderKey: 'o1', arbitratedBy: null },
      { ...EXISTING({ id: 'decl', refundError: 'engine_failed: x', arbitrationReason: 'NOTE INTERNE' }), orderId: 'o1', consumerId: 'u1', activeOrderKey: null, arbitratedBy: 'op1' },
    ]
    db.claim.findMany.mockResolvedValue(claims)
    db.refund.findMany.mockResolvedValue([{ ...ROW('succeeded'), stripeRefundId: 're_1' }])
    db.claim.groupBy.mockResolvedValue([{ refundId: 'rf1', _count: { _all: 1 } }])
    const out = await listConsumerClaims('u1')
    expect(out.map((c) => [c.id, c.status])).toEqual([['a', 'refunded'], ['d', 'restaurant_review'], ['decl', 'closed_by_support']])
    expect(db.refund.findMany).toHaveBeenCalledTimes(1)
    expect(db.claim.groupBy).toHaveBeenCalledTimes(1)
    for (const c of out) for (const k of ['refundError', 'refundId', 'refundAttempted', 'activeOrderKey', 'arbitratedBy']) expect(Object.keys(c), `${c.id} ${k}`).not.toContain(k)
    expect(out.find((c) => c.id === 'decl')?.arbitrationReason).toBeNull()
    db.refund.findMany.mockRejectedValue(new Error('db down'))
    const unread = await listConsumerClaims('u1')
    expect(unread.map((c) => [c.id, c.status])).toEqual([['a', 'financial_verification'], ['d', 'restaurant_review'], ['decl', 'closed_by_support']])
  })

  it('NEGATIVE CONTROL — a groupBy throw never turns a restaurant_review claim into FV; the break mutant (no third argument) reads the succeeded row as FV', async () => {
    db.claim.findMany.mockResolvedValue([{ ...EXISTING({ id: 'd', status: 'restaurant_review', refundId: null, refundAttempted: false, arbitrationDecision: null }), orderId: 'o1', consumerId: 'u1' }])
    db.refund.findMany.mockResolvedValue([])
    db.claim.groupBy.mockRejectedValue(new Error('db down'))
    expect((await listConsumerClaims('u1')).map((c) => c.status)).toEqual(['restaurant_review'])
    expect(customerClaimStatus(EXISTING(), null)).toBe('financial_verification') // ← what the break would show
    expect(customerClaimStatus(EXISTING(), null, true)).toBe('refunded')
  })
})
