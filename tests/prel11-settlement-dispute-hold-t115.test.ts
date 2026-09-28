import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * T-115 — THE SETTLEMENT MUST NOT PAY A ROYALTY ON A SALE STRIPE ALREADY TOOK BACK.
 *
 * Found by the final invariant review on the dispute side. Since T-107 a LOST chargeback is RECORDED while
 * `CHARGEBACKS_ENABLED` is closed, but no unwind runs — so `FranchiseRoyalty.refundedCents` is never reduced
 * and `netOwedCents` still reports the FULL royalty as owed. The franchisor would be paid for revenue the
 * platform no longer has.
 *
 * The rejected fix and why it matters: writing the royalty slice down at observation time needs the charge
 * total and the application fee, which only Stripe knows, and `recordDisputeObservation` is DEFINED by making
 * no Stripe call. A number that cannot be derived must not be written. So the refusal lives where the money
 * would actually leave, and uses a fact we hold: this order's chargeback was lost and never unwound.
 *
 * The other three settlement suites model `dispute.findMany` as « none », which is right for the arithmetic
 * they prove — and it is exactly why this file exists. A filter whose only fixture is the empty list is
 * indistinguishable from no filter at all.
 */

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { transfers: { create: vi.fn(), list: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    operator:         { findUnique: vi.fn() },
    franchiseRoyalty: { findMany: vi.fn(), aggregate: vi.fn(), updateMany: vi.fn() },
    dispute:          { findMany: vi.fn() },
    payout:           { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction:     vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(), sendAdminAlert: vi.fn() }))

import { settleFranchisor } from '@/lib/franchise-settlement'

/** The where-clause of the ATOMIC CLAIM — the update that moves lines out of 'pending'. */
const claimWhere = () => db.franchiseRoyalty.updateMany.mock.calls
  .find((c) => c[0]?.data?.status === 'settling')?.[0]?.where

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FRANCHISE_SETTLEMENT_ENABLED = 'true'   // the rail is OPEN here: the hold must work anyway
  db.operator.findUnique.mockResolvedValue({
    id: 'op_fr', franchiseStripeAccountId: 'acct_fr', franchisePayoutStatus: 'active',
  })
  db.franchiseRoyalty.findMany.mockResolvedValue([])   // no interrupted batch
  db.franchiseRoyalty.aggregate.mockResolvedValue({ _count: 2, _sum: { royaltyCents: 100_000, refundedCents: 0 } })
  db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 0 })   // claim 0 → skipped, before any money
  db.dispute.findMany.mockResolvedValue([])
})
afterEach(() => { delete process.env.FRANCHISE_SETTLEMENT_ENABLED })

describe('T-115 — an un-unwound LOST chargeback holds its order back from the batch', () => {
  it('the claim EXCLUDES the disputed orders — and asks for exactly the right disputes', async () => {
    db.dispute.findMany.mockResolvedValue([{ orderId: 'ord_lost_1' }, { orderId: 'ord_lost_2' }])
    await settleFranchisor('op_fr')

    // it looks for LOST-and-not-unwound only: an open dispute has taken nothing, and an already-unwound one
    // has ALREADY had its slice written into refundedCents, so holding it back would under-pay the franchisor
    expect(db.dispute.findMany).toHaveBeenCalledWith({
      where:  { status: 'lost', splitReversed: false, NOT: { orderId: null } },
      select: { orderId: true },
    })
    expect(claimWhere()).toMatchObject({
      franchisorOperatorId: 'op_fr',
      status: 'pending',
      orderId: { notIn: ['ord_lost_1', 'ord_lost_2'] },
    })
  })

  it('NEGATIVE CONTROL — no un-unwound dispute → the claim carries NO orderId filter (byte-identical to before)', async () => {
    await settleFranchisor('op_fr')
    const w = claimWhere()
    expect(w).toEqual({ franchisorOperatorId: 'op_fr', status: 'pending' })
    expect(w).not.toHaveProperty('orderId')
  })

  it('duplicate orderIds are de-duplicated, and a null orderId can never enter the filter', async () => {
    // Two disputes on one order (won then re-disputed) must not produce a `notIn` with a repeat, and a
    // dispute we could not join to an order must not contribute `null` — which MySQL would treat as unknown
    // and which would silently change the claim's meaning.
    db.dispute.findMany.mockResolvedValue([
      { orderId: 'ord_x' }, { orderId: 'ord_x' }, { orderId: null }, { orderId: 'ord_y' },
    ])
    await settleFranchisor('op_fr')
    expect(claimWhere().orderId).toEqual({ notIn: ['ord_x', 'ord_y'] })
  })

  it('an implausible number of held orders REFUSES the run instead of sending a blind `notIn`', async () => {
    db.dispute.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, (_, i) => ({ orderId: `ord_${i}` })),
    )
    const out = await settleFranchisor('op_fr')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op_fr', reason: 'too_many_held_disputes' })
    // nothing claimed, nothing transferred: settling later costs nothing, settling wrongly costs money
    expect(db.franchiseRoyalty.updateMany).not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('exactly AT the bound the run proceeds — the refusal is a ceiling, not an off-by-one', async () => {
    db.dispute.findMany.mockResolvedValue(
      Array.from({ length: 5000 }, (_, i) => ({ orderId: `ord_${i}` })),
    )
    const out = await settleFranchisor('op_fr')
    expect(out).not.toMatchObject({ reason: 'too_many_held_disputes' })
    expect(claimWhere().orderId.notIn).toHaveLength(5000)
  })

  it('the hold is applied BEFORE the claim, so a held line is never moved out of `pending`', async () => {
    /* The ordering is the whole point: 'pending' is the re-claimable state. A line held back stays settleable
       the moment the unwind runs and writes the real, Stripe-derived slice — whereas a line claimed and then
       reverted would depend on a revert path, which is the failure T-116 exists for. */
    const order: string[] = []
    db.dispute.findMany.mockImplementation(async () => { order.push('dispute-read'); return [{ orderId: 'ord_lost_1' }] })
    db.franchiseRoyalty.updateMany.mockImplementation(async () => { order.push('claim'); return { count: 0 } })
    await settleFranchisor('op_fr')
    expect(order[0]).toBe('dispute-read')
    expect(order.indexOf('dispute-read')).toBeLessThan(order.indexOf('claim'))
  })

  it('the RESUME path is deliberately NOT filtered — a claimed batch is finished, not re-shaped', async () => {
    /* Dropping a line from a batch that may already have an executed transfer would fight the amount-drift
       detector and could strand a franchisor's whole batch. Asserted so the exemption stays a decision rather
       than becoming an oversight: on the resume path the dispute read never happens. */
    db.franchiseRoyalty.findMany.mockResolvedValue([
      { id: 'l1', royaltyCents: 100, refundedCents: 0, settlementId: 'SID' },
    ])
    db.payout.findUnique.mockResolvedValue({ id: 'po_1', status: 'paid', amountCents: 100 })
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      typeof fn === 'function' ? fn({ franchiseRoyalty: { updateMany: vi.fn() }, payout: { update: vi.fn() } }) : undefined)
    await settleFranchisor('op_fr').catch(() => { /* the resume fixtures stop short; the read is the point */ })
    expect(db.dispute.findMany).not.toHaveBeenCalled()
  })
})
