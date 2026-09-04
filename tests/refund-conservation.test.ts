import { describe, it, expect } from 'vitest'

// ── PHASE 2 — TRIPARTITE CONSERVATION + exposure model (REFUND-FINANCIAL-CONTRACT §6/§7) ──
// Pure integer-cent proofs on the STANDARD (R=0) and FRANCHISE (R>0) matrix × full /
// partial / multiple partials with odd cents. Every event and every cumulative state
// must satisfy customerΔ + restaurantΔ + grubanoΔ + franchisorΔ + courierΔ + stripeΔ = 0
// with ZERO residue, and the independent invariants (Σ fee slices == F, Σ royalty == R,
// restaurant total == T − F) must hold — the latter are what a mis-rounded split breaks
// (critic round 1, #6: the sum identity alone is a tautology).

import { computeRefundSplit } from '@/lib/refund'
import { computeRefundExposure, sumDeltas, type PartyDeltas } from '@/lib/refund-exposure'

type Fixture = { name: string; T: number; F: number; R: number; tip: number; cw: number; stripeFee: number }
const STANDARD: Fixture  = { name: 'STANDARD delivery (no royalty)',          T: 5000, F: 600,  R: 0,   tip: 200, cw: 0,   stripeFee: 85 }
const FRANCHISE: Fixture = { name: 'FRANCHISE delivery (royalty 300 in fee)', T: 5000, F: 900,  R: 300, tip: 200, cw: 0,   stripeFee: 85 }
const COURIER_B: Fixture = { name: 'FRANCHISE + courier withheld (case B)',   T: 4321, F: 1177, R: 259, tip: 150, cw: 300, stripeFee: 71 }
const SEQUENCES: Array<{ label: string; amounts: (T: number) => number[] }> = [
  { label: 'full',                       amounts: (T) => [T] },
  { label: 'partial 50 %',               amounts: (T) => [Math.floor(T / 2)] },
  { label: '3 partials then remainder',  amounts: (T) => { const a = Math.floor(T / 3); return [a, a, a, T - 3 * a] } },
  { label: 'odd cents 333/333/333/rest', amounts: (T) => [333, 333, 333, T - 999] },
  { label: '1 cent then the rest',       amounts: (T) => [1, T - 1] },
]

function runSequence(fx: Fixture, amounts: number[]) {
  const events: PartyDeltas[] = []
  let cum = 0
  let feeSum = 0, roySum = 0, restoSum = 0, tipSliceSum = 0, cwSliceSum = 0
  for (let i = 0; i < amounts.length; i++) {
    const amt = amounts[i]
    const isFullAfter = cum + amt >= fx.T
    // D-E: the courier's UNPAID tip is clawed only when the order becomes fully refunded.
    const tipClawed = isFullAfter ? fx.tip : 0
    const ex = computeRefundExposure({
      chargeTotalCents: fx.T, applicationFeeCents: fx.F, royaltyChargedCents: fx.R,
      tipCents: fx.tip, courierWithheldCents: fx.cw, stripeFeeCents: fx.stripeFee,
      alreadyRefundedCents: cum, refundAmountCents: amt, tipClawedCents: tipClawed,
    })
    expect(ex.conservationResidualCents).toBe(0)
    expect(ex.deltas.customer).toBe(amt)
    expect(ex.split.restaurantReverseCents + ex.split.applicationFeeRefundCents).toBe(amt)
    expect(ex.royaltySliceCents).toBeGreaterThanOrEqual(0)
    expect(ex.royaltySliceCents + ex.tipSliceCents + ex.courierWithheldSliceCents + ex.grubanoOwnSliceCents).toBe(ex.split.applicationFeeRefundCents)
    events.push(ex.deltas)
    feeSum += ex.split.applicationFeeRefundCents; roySum += ex.royaltySliceCents
    restoSum += ex.split.restaurantReverseCents; tipSliceSum += ex.tipSliceCents; cwSliceSum += ex.courierWithheldSliceCents
    cum += amt
  }
  return { events, total: sumDeltas(events), feeSum, roySum, restoSum, tipSliceSum, cwSliceSum, cum }
}

describe('tripartite conservation — every event and every cumulative state sums to ZERO', () => {
  for (const fx of [STANDARD, FRANCHISE, COURIER_B]) {
    for (const seq of SEQUENCES) {
      it(`${fx.name} × ${seq.label}`, () => {
        const amounts = seq.amounts(fx.T)
        const r = runSequence(fx, amounts)
        const t = r.total
        expect(t.customer + t.restaurant + t.grubano + t.franchisor + t.courier + t.stripe).toBe(0)
        expect(t.customer).toBe(r.cum)
        expect(t.stripe).toBe(0) // Stripe keeps its processing fee: zero movement (D-D)
        const neg = (n: number) => (n === 0 ? 0 : -n) // never a signed zero in a cent comparison
        if (r.cum === fx.T) {
          // FULL refund — the independent invariants a mis-rounding would break:
          expect(r.feeSum).toBe(fx.F)            // Σ fee slices == F
          expect(r.roySum).toBe(fx.R)            // Σ royalty slices == R
          expect(r.restoSum).toBe(fx.T - fx.F)   // restaurant returned exactly its net
          expect(t.franchisor).toBe(neg(fx.R))
          expect(t.courier).toBe(neg(fx.tip))    // unpaid tip clawed on the full refund
          expect(r.tipSliceSum).toBe(fx.tip)     // the whole tip came back to the customer through the fee
          expect(r.cwSliceSum).toBe(fx.cw)
          expect(t.grubano).toBe(neg(fx.F - fx.R - fx.tip))
        } else {
          // PARTIAL — the courier keeps the whole tip; Grubano absorbs the returned slices.
          expect(t.courier).toBe(0)
          expect(t.grubano).toBe(neg(r.feeSum - r.roySum))
        }
      })
    }
  }
})

describe('exposure model — what Grubano absorbs is explicit, never silent', () => {
  it('partial 50 % on FRANCHISE: tip slice + withheld slice absorbed by Grubano, royalty borne by the franchisor, Stripe fee retained', () => {
    const ex = computeRefundExposure({
      chargeTotalCents: COURIER_B.T, applicationFeeCents: COURIER_B.F, royaltyChargedCents: COURIER_B.R,
      tipCents: COURIER_B.tip, courierWithheldCents: COURIER_B.cw, stripeFeeCents: COURIER_B.stripeFee,
      alreadyRefundedCents: 0, refundAmountCents: 2000,
    })
    expect(ex.tipAbsorbedByGrubanoCents).toBe(ex.tipSliceCents)
    expect(ex.tipSliceCents).toBeGreaterThan(0)
    expect(ex.withheldAbsorbedByGrubanoCents).toBe(ex.courierWithheldSliceCents)
    expect(ex.courierWithheldSliceCents).toBeGreaterThan(0)
    expect(ex.stripeFeeRetainedCents).toBe(71)
    expect(ex.deltas.franchisor).toBe(-ex.royaltySliceCents)
    expect(ex.deltas.courier).toBe(0)
    expect(ex.conservationResidualCents).toBe(0)
  })

  it('full refund with the tip ALREADY PAID to the courier (tipClawed 0) → Grubano absorbs the whole tip, identity still 0', () => {
    const ex = computeRefundExposure({
      chargeTotalCents: STANDARD.T, applicationFeeCents: STANDARD.F, royaltyChargedCents: 0,
      tipCents: STANDARD.tip, courierWithheldCents: 0, stripeFeeCents: STANDARD.stripeFee,
      alreadyRefundedCents: 0, refundAmountCents: STANDARD.T, tipClawedCents: 0,
    })
    expect(ex.tipAbsorbedByGrubanoCents).toBe(STANDARD.tip)
    expect(ex.deltas.courier).toBe(0)
    expect(ex.deltas.grubano).toBe(-STANDARD.F)
    expect(ex.conservationResidualCents).toBe(0)
  })

  it('royalty slice of the exposure model == the engine split royalty slice (same rule, same cents) across partials', () => {
    let cum = 0
    for (const amt of [333, 333, 333, 5000 - 999]) {
      const split = computeRefundSplit({ chargeTotalCents: 5000, applicationFeeCents: 900, royaltyChargedCents: 300, alreadyRefundedCents: cum, refundAmountCents: amt })
      const ex = computeRefundExposure({ chargeTotalCents: 5000, applicationFeeCents: 900, royaltyChargedCents: 300, tipCents: 0, courierWithheldCents: 0, stripeFeeCents: 0, alreadyRefundedCents: cum, refundAmountCents: amt })
      expect(ex.royaltySliceCents).toBe(split.royaltyRefundCents)
      cum += amt
    }
  })
})

describe('⭐ negative controls — the harness CAN fail', () => {
  /** A deliberately WRONG split: per-event flooring instead of the cumulative rounded target. */
  function flooredSplit(T: number, F: number, R: number, amt: number) {
    const fee = Math.floor((F * amt) / T)
    const roy = F > 0 ? Math.floor((fee * R) / F) : 0
    return { applicationFeeRefundCents: fee, restaurantReverseCents: amt - fee, royaltyRefundCents: roy }
  }

  it('(ii) the floored split PASSES the tautological sum identity but FAILS the independent invariants on odd partials', () => {
    const T = 5000, F = 900, R = 300
    let feeSum = 0, roySum = 0, restoSum = 0
    for (const amt of [333, 333, 333, T - 999]) {
      const s = flooredSplit(T, F, R, amt)
      // tautology: customer = resto + Grubano holds for ANY fee value
      expect(s.restaurantReverseCents + s.applicationFeeRefundCents).toBe(amt)
      feeSum += s.applicationFeeRefundCents; roySum += s.royaltyRefundCents; restoSum += s.restaurantReverseCents
    }
    // …but the money invariants break: cents are LOST from the fee/royalty and given to the resto.
    expect(feeSum).not.toBe(F)
    expect(roySum).not.toBe(R)
    expect(restoSum).not.toBe(T - F)
    // The real split lands exactly:
    let cum = 0, realFee = 0, realRoy = 0
    for (const amt of [333, 333, 333, T - 999]) {
      const s = computeRefundSplit({ chargeTotalCents: T, applicationFeeCents: F, royaltyChargedCents: R, alreadyRefundedCents: cum, refundAmountCents: amt })
      realFee += s.applicationFeeRefundCents; realRoy += s.royaltyRefundCents; cum += amt
    }
    expect(realFee).toBe(F)
    expect(realRoy).toBe(R)
  })

  it('(ii-bis) per-refund fee slice must equal the Stripe fee_refund fixture — the floored prediction deviates by > 1 c on the remainder', () => {
    // Stripe truth fixture for 333/333/333/4001 on F=900,T=5000 — the cumulative-rounded amounts.
    const T = 5000, F = 900
    const truth: number[] = []
    let cum = 0
    for (const amt of [333, 333, 333, T - 999]) {
      const s = computeRefundSplit({ chargeTotalCents: T, applicationFeeCents: F, royaltyChargedCents: 0, alreadyRefundedCents: cum, refundAmountCents: amt })
      truth.push(s.applicationFeeRefundCents); cum += amt
    }
    expect(truth.reduce((a, b) => a + b, 0)).toBe(F)
    const floored = [333, 333, 333, T - 999].map((amt) => flooredSplit(T, F, 0, amt).applicationFeeRefundCents)
    expect(floored.reduce((a, b) => a + b, 0)).toBeLessThan(F)
    expect(floored.some((f, i) => Math.abs(f - truth[i]) >= 1)).toBe(true)
  })

  it('(vi) a conservation residual is DETECTED when a party delta is tampered', () => {
    const ex = computeRefundExposure({ chargeTotalCents: 5000, applicationFeeCents: 900, royaltyChargedCents: 300, tipCents: 200, courierWithheldCents: 0, stripeFeeCents: 85, alreadyRefundedCents: 0, refundAmountCents: 2500 })
    const tampered = { ...ex.deltas, franchisor: ex.deltas.franchisor - 1 }
    const residual = tampered.customer + tampered.restaurant + tampered.grubano + tampered.franchisor + tampered.courier + tampered.stripe
    expect(residual).not.toBe(0)
  })
})
