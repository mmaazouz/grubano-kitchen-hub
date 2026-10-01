// ── Phase 2 — Refund EXPOSURE model + tripartite conservation (pure, integer cents) ─
//
// `computeRefundSplit` (lib/refund) says how much money moves between Stripe balances
// (customer ← platform fee refund + connected-account reversal). THIS module says WHO
// BEARS each cent of the refunded application fee, because the fee is a composite the
// platform only partly owns (REFUND-FINANCIAL-CONTRACT §1):
//   • commission + small-order fee   → Grubano's own revenue
//   • franchise royalty              → owed to the franchisor (FranchiseRoyalty)
//   • courier tip                    → owed to the courier (CourierEarning 'tip')
//   • courier withheld deliveryFee   → owed to the courier (case-B routing)
// Stripe prorates the WHOLE fee on a refund; each component's refunded slice is the
// telescoped cumulative target round(feeCum · component / F) — exactly the royalty rule
// of computeRefundSplit, so the royalty slice here == the engine's royaltyRefundCents.
// Component slices may not sum to the fee refund by ±1 c of rounding: the residual is
// assigned to Grubano's own slice, so the identity below holds EXACTLY.
//
// DECISIONS (contract §6, D-D / D-E — founder may override D-E):
//   • Stripe processing fee: never returned by Stripe → zero movement, Grubano's sunk
//     cost; it appears in the identity as Stripe's party with Δ = 0.
//   • Courier tip on a PARTIAL refund: the courier keeps the whole tip (service done);
//     Grubano ABSORBS the returned tip slice. On a FULL refund the unpaid tip is clawed
//     (existing clawbackCourierTip) → the courier bears it; a tip already PAID stays with
//     the courier → Grubano absorbs it (customer-friendly, documented).
//   • Courier withheld deliveryFee slice: ALWAYS absorbed by Grubano (the course stays
//     acquired — decided P4.3).
//
// CONSERVATION (contract §7): for every refund event
//   customerΔ + restaurantΔ + grubanoΔ + franchisorΔ + courierΔ + stripeΔ === 0
// with customerΔ = +amount, restaurantΔ = −restaurantReverse, franchisorΔ = −royaltySlice,
// courierΔ = −tipClawed, grubanoΔ = −(feeRefund − royaltySlice − tipClawed), stripeΔ = 0.

import { computeRefundSplit, type RefundSplit } from '@/lib/refund'

export interface RefundExposureInput {
  chargeTotalCents:      number
  applicationFeeCents:   number
  royaltyChargedCents:   number
  tipCents:              number
  courierWithheldCents:  number
  /** Stripe processing fee on the original charge (balance transaction) — never returned. */
  stripeFeeCents:        number
  alreadyRefundedCents:  number
  refundAmountCents:     number
  /** Tip cents actually clawed back from the courier for THIS event (0 on a partial, or
   *  when the tip was already paid; = tipCents when the full refund cancels an unpaid tip). */
  tipClawedCents?:       number
}

export interface PartyDeltas {
  customer:   number
  restaurant: number
  grubano:    number
  franchisor: number
  courier:    number
  stripe:     number
}

export interface RefundExposure {
  split:                        RefundSplit
  /** Slices of the refunded fee, by component (telescoped cumulative targets). */
  royaltySliceCents:            number
  tipSliceCents:                number
  courierWithheldSliceCents:    number
  grubanoOwnSliceCents:         number   // fee refund − (royalty + tip + withheld) — carries the rounding residual
  /** What Grubano absorbs beyond its own revenue slice on THIS event. */
  tipAbsorbedByGrubanoCents:    number   // tipSlice − tipClawed (≥ 0)
  withheldAbsorbedByGrubanoCents: number // = courierWithheldSlice
  stripeFeeRetainedCents:       number   // = stripeFeeCents, unchanged (zero movement)
  deltas:                       PartyDeltas
  /** Σ deltas — MUST be 0. Exposed so a test can assert it (and a broken split can fail it). */
  conservationResidualCents:    number
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(Math.max(lo, Math.trunc(n)), hi)

/** Telescoped cumulative slice of `component` (⊂ F) inside the fee refund between Cprev and C. */
function componentSlice(T: number, F: number, component: number, Cprev: number, C: number): number {
  if (T <= 0 || F <= 0 || component <= 0) return 0
  const feeCum = (x: number) => Math.round((F * x) / T)
  const cum    = (x: number) => Math.round((feeCum(x) * component) / F)
  return Math.max(0, cum(C) - cum(Cprev))
}

export function computeRefundExposure(input: RefundExposureInput): RefundExposure {
  const T     = Math.max(0, Math.trunc(input.chargeTotalCents))
  const F     = clampInt(input.applicationFeeCents, 0, T)
  const R     = clampInt(input.royaltyChargedCents, 0, F)
  const tip   = clampInt(input.tipCents, 0, F)
  const cw    = clampInt(input.courierWithheldCents, 0, F)
  const Cprev = clampInt(input.alreadyRefundedCents, 0, T)
  const amt   = Math.max(0, Math.trunc(input.refundAmountCents))
  const C     = Math.min(Cprev + amt, T)

  const split = computeRefundSplit({
    chargeTotalCents:     T,
    applicationFeeCents:  F,
    royaltyChargedCents:  R,
    alreadyRefundedCents: Cprev,
    refundAmountCents:    amt,
  })
  const feeRefund = split.applicationFeeRefundCents

  const royaltySliceCents         = split.royaltyRefundCents // identical rule → identical cents
  const tipSliceCents             = Math.min(componentSlice(T, F, tip, Cprev, C), Math.max(0, feeRefund - royaltySliceCents))
  const courierWithheldSliceCents = Math.min(componentSlice(T, F, cw, Cprev, C), Math.max(0, feeRefund - royaltySliceCents - tipSliceCents))
  const grubanoOwnSliceCents      = feeRefund - royaltySliceCents - tipSliceCents - courierWithheldSliceCents

  const tipClawed = clampInt(input.tipClawedCents ?? 0, 0, tip)
  const tipAbsorbedByGrubanoCents = Math.max(0, tipSliceCents - tipClawed)

  // neg() keeps a signed zero out of the money model (-0 is a JS artefact, not a cent).
  const neg = (n: number) => (n === 0 ? 0 : -n)
  const deltas: PartyDeltas = {
    customer:   split.restaurantReverseCents + feeRefund, // === amt (customer-exact)
    restaurant: neg(split.restaurantReverseCents),
    franchisor: neg(royaltySliceCents),
    courier:    neg(tipClawed),
    grubano:    neg(feeRefund - royaltySliceCents - tipClawed),
    stripe:     0,
  }
  const conservationResidualCents =
    deltas.customer + deltas.restaurant + deltas.grubano + deltas.franchisor + deltas.courier + deltas.stripe

  return {
    split,
    royaltySliceCents,
    tipSliceCents,
    courierWithheldSliceCents,
    grubanoOwnSliceCents,
    tipAbsorbedByGrubanoCents,
    withheldAbsorbedByGrubanoCents: courierWithheldSliceCents,
    stripeFeeRetainedCents: Math.max(0, Math.trunc(input.stripeFeeCents)),
    deltas,
    conservationResidualCents,
  }
}

/** Sum party deltas over a sequence of events (integer cents). */
export function sumDeltas(events: PartyDeltas[]): PartyDeltas {
  return events.reduce<PartyDeltas>(
    (acc, d) => ({
      customer:   acc.customer + d.customer,
      restaurant: acc.restaurant + d.restaurant,
      grubano:    acc.grubano + d.grubano,
      franchisor: acc.franchisor + d.franchisor,
      courier:    acc.courier + d.courier,
      stripe:     acc.stripe + d.stripe,
    }),
    { customer: 0, restaurant: 0, grubano: 0, franchisor: 0, courier: 0, stripe: 0 },
  )
}
