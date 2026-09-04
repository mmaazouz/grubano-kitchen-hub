// ── Phase 2 — ONE rule to attribute Stripe's REAL fee refunds to refunds ─────────
//
// Stripe prorates the application fee itself on `refund_application_fee:true`
// (documented: "proportional to the amount of the charge refunded"; the ROUNDING
// rule is NOT documented). Two writers book the compensating ledger line for a
// refund — the charge.refunded webhook and the engine's eager path — and both must
// use the SAME truth: Stripe's `fee_refund.amount`, never a recomputed prediction.
//
// The Refund object carries no pointer to its fee refund, so attribution is by
// chronological index (the webhook's historical rule). `created` is second-granular:
// two refunds created in the same second can swap fee refunds under independent
// sorts. This module makes that attribution EXPLICIT and fail-safe:
//   • counts differ                     → 'prorata'   (Stripe truth unusable, predicted)
//   • one refund                        → 'stripe'    (no ambiguity possible)
//   • no `created` ties among refunds   → 'stripe'    (order is unambiguous)
//   • ties present, every slice within ±1 c of prediction → 'stripe' (swap-proof)
//   • ties present, a slice deviates    → 'ambiguous' (predicted values, caller logs
//                                          MONEY REVIEW; the engine SKIPS its eager line)
// Pure, integer cents, no I/O.

export interface RefundFact  { id: string; amount: number; created: number }
export interface FeeRefundFact { amount: number; created: number }

export type FeeMatchMode = 'stripe' | 'prorata' | 'ambiguous'

export interface FeeMatchResult {
  mode: FeeMatchMode
  /** refund id → fee cents taken back for THIS refund (Stripe truth or prediction). */
  byRefundId: Map<string, number>
}

/** Stripe's documented proration, rounded — the prediction used for tolerance + fallback. */
export function predictFeeRefund(totalFee: number, chargeAmount: number, refundAmount: number): number {
  return totalFee > 0 && chargeAmount > 0 ? Math.round(totalFee * (refundAmount / chargeAmount)) : 0
}

export function matchFeeRefunds(
  refundsIn: RefundFact[],
  feeRefundsIn: FeeRefundFact[],
  totalFee: number,
  chargeAmount: number,
): FeeMatchResult {
  // Deterministic order: created, then id (refunds) — fee refunds by created only.
  const refunds = [...refundsIn].sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const fees    = [...feeRefundsIn].sort((a, b) => a.created - b.created)

  const prorata = new Map<string, number>()
  for (const r of refunds) prorata.set(r.id, predictFeeRefund(totalFee, chargeAmount, r.amount))

  if (fees.length !== refunds.length || refunds.length === 0) {
    return { mode: 'prorata', byRefundId: prorata }
  }

  const byRefundId = new Map<string, number>()
  refunds.forEach((r, i) => byRefundId.set(r.id, fees[i].amount))

  if (refunds.length === 1) return { mode: 'stripe', byRefundId }

  const hasTies = refunds.some((r, i) => i > 0 && refunds[i - 1].created === r.created)
  if (!hasTies) return { mode: 'stripe', byRefundId }

  const withinTolerance = refunds.every((r) => Math.abs((byRefundId.get(r.id) ?? 0) - (prorata.get(r.id) ?? 0)) <= 1)
  return withinTolerance
    ? { mode: 'stripe', byRefundId }
    : { mode: 'ambiguous', byRefundId: prorata }
}
