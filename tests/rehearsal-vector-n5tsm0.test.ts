// tests/rehearsal-vector-n5tsm0.test.ts — DRY-RUN of the CURRENT refund engine on the first
// Stripe TEST rehearsal target, with the Stripe facts MEASURED on 2026-09-05 (read-only):
//   GR-N5TSM0 (cmtju919h0001h7t6bkn5tsm0): charge captured 1410 c, application fee 76 c, transfer
//   1410 c to the connected account, 0 refunds ; order pointsRedeemed 8 (loyaltyCreditCents 40),
//   pointsEarned 14 (credited at delivery), standard restaurant (royalty 0).
// Intended first rehearsal: ONE partial refund of 500 c of ACTUAL Stripe cash. This file pins the
// engine's own output (computeRefundSplit + planLoyaltyRefund + offset arithmetic) so the
// operator's re-measured inputs can be compared to a fixed, engine-derived vector. No I/O.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({}) }))
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn() }))

import { computeRefundSplit } from '@/lib/refund'
import { planLoyaltyRefund, loyaltyPointsCumulative, applyReversalWithOffset, applyEarnWithOffsetRepay } from '@/lib/loyalty-refund'

const MEASURED = {
  chargeTotalCents: 1410,     // Stripe charge.amount_captured (2026-09-05)
  applicationFeeCents: 76,    // Stripe application_fee.amount
  transferCents: 1410,        // Stripe transfer.amount (destination charge, on_behalf_of)
  royaltyChargedCents: 0,     // standard restaurant — no FranchiseRoyalty row
  alreadyRefundedCents: 0,    // charge.amount_refunded
  pointsRedeemed: 8,          // Order.pointsRedeemed (DB, v3) — loyaltyCreditCents 40 → 5 c / point
  pointsEarned: 14,           // Order.pointsEarned (DB, v3), credited at delivery
  cashInput: 500,
}

describe('GR-N5TSM0 — first rehearsal vector from the CURRENT engine (500 c partial, mixed funding)', () => {
  const split = computeRefundSplit({
    chargeTotalCents: MEASURED.chargeTotalCents,
    applicationFeeCents: MEASURED.applicationFeeCents,
    royaltyChargedCents: MEASURED.royaltyChargedCents,
    alreadyRefundedCents: MEASURED.alreadyRefundedCents,
    refundAmountCents: MEASURED.cashInput,
  })
  const plan = planLoyaltyRefund({
    refunds: [{ id: 're_REHEARSAL', amountCents: MEASURED.cashInput, createdUnix: 1 }],
    chargeAmountCents: MEASURED.chargeTotalCents,
    earnedCredited: MEASURED.pointsEarned,
    pointsRedeemed: MEASURED.pointsRedeemed,
  })

  it('Stripe money split: cash 500 = fee refund 27 (round(76·500/1410)) + restaurant reversal 473 ; royalty 0', () => {
    expect(split.applicationFeeRefundCents).toBe(27)
    expect(split.restaurantReverseCents).toBe(473)
    expect(split.applicationFeeRefundCents + split.restaurantReverseCents).toBe(500)
    expect(split.royaltyRefundCents).toBe(0)
    expect(split.cumulativeRoyaltyRefundedCents).toBe(0)
    expect(split.fraction).toBeCloseTo(500 / 1410, 6)
  })
  it('Grubano retained application fee after the refund = 76 − 27 = 49 ; required connected-account AVAILABLE balance = 473', () => {
    expect(MEASURED.applicationFeeCents - split.applicationFeeRefundCents).toBe(49)
    expect(split.restaurantReverseCents).toBe(473)
  })
  it('loyalty plan (Phase 1 prorata on charge.amount, cumulative): earned reversal 5 (round(14·500/1410)), spent restore 3 (round(8·500/1410))', () => {
    expect(plan).toEqual([{ sourceEventId: 're_REHEARSAL', earnReversal: 5, spentRestore: 3 }])
    expect(loyaltyPointsCumulative(14, 1410, 500)).toBe(5)
    expect(loyaltyPointsCumulative(8, 1410, 500)).toBe(3)
  })
  it('recovery offset delta depends on the CURRENT balance (DB): balance ≥ 5 → offset +0 ; balance b < 5 → offset +(5 − b)', () => {
    expect(applyReversalWithOffset(5, 100)).toEqual({ balanceDecrement: 5, offsetIncrease: 0 })
    expect(applyReversalWithOffset(5, 2)).toEqual({ balanceDecrement: 2, offsetIncrease: 3 })
    // a future earn repays a pending offset first
    expect(applyEarnWithOffsetRepay(10, 3)).toEqual({ offsetRepaid: 3, spendableIncrement: 7, newOffset: 0 })
  })
  it('customer economic restoration = 500 c cash + 3 restored points (15 c at 5 c/pt) − 5 reversed points (25 c) = 490 c equivalent ; cash-only view 515 c', () => {
    const centsPerPoint = 40 / 8
    const restoredCents = plan[0].spentRestore * centsPerPoint
    const reversedCents = plan[0].earnReversal * centsPerPoint
    expect(centsPerPoint).toBe(5)
    expect(500 + restoredCents).toBe(515)
    expect(500 + restoredCents - reversedCents).toBe(490)
  })
  it('a second identical partial (500 → cumulative 1000) telescopes: fee 54 cumulative (27 + 27), loyalty 10 / 6 cumulative', () => {
    const s2 = computeRefundSplit({ chargeTotalCents: 1410, applicationFeeCents: 76, royaltyChargedCents: 0, alreadyRefundedCents: 500, refundAmountCents: 500 })
    expect(s2.applicationFeeRefundCents).toBe(27)
    expect(loyaltyPointsCumulative(14, 1410, 1000)).toBe(10)
    expect(loyaltyPointsCumulative(8, 1410, 1000)).toBe(6)
  })
  it('GR-BZE1X future FULL refund (1450 c, fee 116, pickup, 0 pts redeemed per Stripe facts): fee refund 116, reversal 1334', () => {
    const full = computeRefundSplit({ chargeTotalCents: 1450, applicationFeeCents: 116, royaltyChargedCents: 0, alreadyRefundedCents: 0, refundAmountCents: 1450 })
    expect(full.applicationFeeRefundCents).toBe(116)
    expect(full.restaurantReverseCents).toBe(1334)
  })
})
