// ── Phase 2 — ONE rule to book Stripe's ACTUAL refund truth in the ledger ─────────
//
// FOUNDER INVARIANT (Phase 2 final hardening, F2 closed):
//   STRIPE ACTUAL FINANCIAL TRUTH == GRUBANO ACTUAL LEDGER TRUTH.
//   If Stripe refunded no application fee for a refund → the ledger books 0 fee-back.
//   If Stripe reversed no transfer for a refund → the ledger books 0 restaurant give-back.
//   A prediction (proration formula) may ONLY appear as an expectation / MONEY REVIEW,
//   never as a settled ledger amount.
//
// Stripe prorates the application fee itself on `refund_application_fee:true` and
// creates one ApplicationFeeRefund (`fr_…`) per such refund; a refund issued WITHOUT
// that flag (Dashboard box unticked) creates NO fee refund. The Refund object carries
// no pointer to its fee refund, so attribution is by chronology + amount:
//   • no fee refund at all                 → 'none'     : every refund books 0
//   • counts equal, order unambiguous      → 'stripe'   : chronological index match
//   • otherwise                            → 'matched'  : each fee refund is attributed to
//                                             the earliest still-unassigned refund created
//                                             at/before it whose Stripe proration (naive or
//                                             cumulative) is within ±1 c of the fee amount;
//                                             refunds left without a fee refund book 0
//   • a fee refund that matches nothing    → 'residual' : it is still booked (on the latest
//                                             refund created at/before it) so the ledger
//                                             SUM equals Stripe's SUM; flagged MONEY REVIEW
// In every mode  Σ byRefundId == Σ fee refund amounts  (exactly). Pure, integer cents.

export interface RefundFact  { id: string; amount: number; created: number }
export interface FeeRefundFact { amount: number; created: number }

export type FeeMatchMode = 'none' | 'stripe' | 'matched' | 'residual'

export interface FeeMatchResult {
  mode: FeeMatchMode
  /** refund id → ACTUAL fee cents Stripe took back for THIS refund (0 when none). */
  byRefundId: Map<string, number>
  /** cents of fee refunds attributed by the residual rule (0 unless mode === 'residual'). */
  residualCents: number
}

/** Stripe's documented proration, rounded — an EXPECTATION only (tolerance / review). */
export function predictFeeRefund(totalFee: number, chargeAmount: number, refundAmount: number): number {
  return totalFee > 0 && chargeAmount > 0 ? Math.round(totalFee * (refundAmount / chargeAmount)) : 0
}

const byCreatedThenId = (a: RefundFact, b: RefundFact) =>
  a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function matchFeeRefunds(
  refundsIn: RefundFact[],
  feeRefundsIn: FeeRefundFact[],
  totalFee: number,
  chargeAmount: number,
): FeeMatchResult {
  const refunds = [...refundsIn].sort(byCreatedThenId)
  const fees    = [...feeRefundsIn].sort((a, b) => a.created - b.created)
  const byRefundId = new Map<string, number>()
  for (const r of refunds) byRefundId.set(r.id, 0)

  if (fees.length === 0 || refunds.length === 0) {
    // Nothing was taken back (or nothing to attribute to): truth is 0 everywhere.
    return { mode: 'none', byRefundId, residualCents: fees.reduce((s, f) => s + f.amount, 0) }
  }

  // Expectations used ONLY to disambiguate: naive proration and the cumulative telescoped one.
  const naive = new Map<string, number>()
  const cumul = new Map<string, number>()
  const feeCum = (x: number) => (chargeAmount > 0 ? Math.round((totalFee * x) / chargeAmount) : 0)
  let prev = 0
  for (const r of refunds) {
    naive.set(r.id, predictFeeRefund(totalFee, chargeAmount, r.amount))
    cumul.set(r.id, feeCum(prev + r.amount) - feeCum(prev))
    prev += r.amount
  }
  const near = (r: RefundFact, amount: number) =>
    Math.abs(amount - (naive.get(r.id) ?? 0)) <= 1 || Math.abs(amount - (cumul.get(r.id) ?? 0)) <= 1

  // Fast path: counts equal AND every chronological pair is consistent with Stripe's own
  // proration (±1 c) → index match. A single refund needs no check (no ambiguity). Without
  // the amount check a no-tie sequence could pair an unrelated fee refund with a refund
  // that carried none (review #2) — such cases fall through to the general attribution.
  if (fees.length === refunds.length) {
    const indexOk = refunds.length === 1 || refunds.every((r, i) => near(r, fees[i].amount))
    if (indexOk) {
      refunds.forEach((r, i) => byRefundId.set(r.id, fees[i].amount))
      return { mode: 'stripe', byRefundId, residualCents: 0 }
    }
  }

  // General attribution: each fee refund → earliest unassigned refund created at/before
  // it (1 s slack) whose expectation is within ±1 c; else residual on the latest refund
  // created at/before it (so the SUM is always Stripe's sum).
  const assigned = new Set<string>()
  let residualCents = 0
  for (const f of fees) {
    const candidates = refunds.filter((r) => !assigned.has(r.id) && r.created <= f.created + 1)
    const hit = candidates.find((r) => near(r, f.amount))
    if (hit) {
      assigned.add(hit.id)
      byRefundId.set(hit.id, (byRefundId.get(hit.id) ?? 0) + f.amount)
      continue
    }
    const before = refunds.filter((r) => r.created <= f.created + 1)
    const target = (before.length ? before[before.length - 1] : refunds[refunds.length - 1])
    byRefundId.set(target.id, (byRefundId.get(target.id) ?? 0) + f.amount)
    residualCents += f.amount
  }
  return { mode: residualCents > 0 ? 'residual' : 'matched', byRefundId, residualCents }
}

/**
 * The compensating ledger line for ONE refund from ACTUAL Stripe movements only:
 *   amountCents      — what the customer got back (Refund.amount)
 *   reversalCents    — what was reversed from the restaurant's connected account
 *                      (Refund.transfer_reversal amount; 0 when no reversal happened)
 *   feeRefundCents   — what Stripe refunded from the application fee (fr_ amount; 0 when none)
 * Restaurant net give-back = reversal − feeRefund (the fee refund is credited BACK to the
 * connected account, contract §9.2). Grubano bears the rest. gross = fee + net holds by
 * construction with negatives.
 */
export function refundLedgerLine(input: { amountCents: number; reversalCents: number; feeRefundCents: number }): {
  grossAmount: number; applicationFeeAmount: number; netToRestaurant: number
} {
  const a  = Math.max(0, Math.trunc(input.amountCents))
  const x  = Math.max(0, Math.trunc(input.reversalCents))
  const fr = Math.max(0, Math.trunc(input.feeRefundCents))
  const netToRestaurant = -(x - fr)
  const applicationFeeAmount = -(a - x + fr)
  const neg0 = (n: number) => (n === 0 ? 0 : n)
  return { grossAmount: neg0(-a), applicationFeeAmount: neg0(applicationFeeAmount), netToRestaurant: neg0(netToRestaurant) }
}
