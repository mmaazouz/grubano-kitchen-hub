// lib/supply-pricing.ts — B2B SUPPLY economics engine (PURE, Slice 5a, Agent 14).
//
// SEPARATE from the B2C rails (lib/pricing, lib/commission, lib/ledger, lib/loyalty,
// lib/refunds, affiliation) — it NEVER imports or touches them. No I/O, no Stripe,
// NO money movement: it takes prices + volume and RETURNS amounts (INTEGER CENTS).
// The payment slice (5b) will CONSUME these numbers; this module decides nothing
// about WHEN or HOW money actually moves.
//
// ── ECONOMICS (all rates configurable; defaults below) ───────────────────────
//  - The resto pays the SUPPLIER price (no markup) — minus its share of any
//    negotiated volume discount.
//  - TAKE-RATE (flat, default 1%, target 2–4%): applies OFF-tier only and is
//    deducted from the SUPPLIER payout (the resto still pays the full price).
//  - VOLUME-DISCOUNT TIERS (negotiated per supplier): at ascending aggregated
//    volume, the supplier grants a discount `d`; of `d`, the resto receives `r`
//    and Grubano keeps `(d − r)`.
//  - ANTI-DOUBLE-CHARGE: when a tier is active, Grubano's margin is ONLY the
//    captured savings share `(d − r)`; the flat take-rate does NOT also apply.
//
// ── CONSERVATION (invariant) ─────────────────────────────────────────────────
//   restoPaysCents === supplierPayoutCents + grubanoMarginCents   (always)
// with NO rounding drift: the two "borne" amounts are rounded, then grubanoMargin
// is DERIVED as their difference (never independently rounded). The resto always
// pays ≤ baseCents (its out-of-Grubano price).

export const DEFAULT_TAKE_RATE = 0.01 // 1% — flat, off-tier, on the supplier payout

export interface SupplyTier {
  /** Minimum aggregated VOLUME (cents) for this tier to apply. */
  minVolumeCents: number
  /** Total negotiated discount the supplier grants at this tier (0.08 = −8%). */
  discountRate: number
  /** Share of the discount passed to the RESTO (≤ discountRate). Grubano keeps (discount − resto). */
  restoShareRate: number
}

// Default negotiated tiers — CONFIGURABLE per supplier agreement. The discount /
// split defaults are the decided economics; the volume thresholds are sensible
// placeholders (the real volumes come from each supplier deal):
//   −8%  → resto −5% / Grubano +3%   at ≥ 200 €
//   −12% → resto −8% / Grubano +4%   at ≥ 500 €
//   −15% → resto −10% / Grubano +5%  at ≥ 1000 €
export const DEFAULT_TIERS: readonly SupplyTier[] = [
  { minVolumeCents:  20_000, discountRate: 0.08, restoShareRate: 0.05 },
  { minVolumeCents:  50_000, discountRate: 0.12, restoShareRate: 0.08 },
  { minVolumeCents: 100_000, discountRate: 0.15, restoShareRate: 0.10 },
] as const

export interface SupplyPricingConfig {
  takeRate: number
  tiers: readonly SupplyTier[]
}
export const DEFAULT_SUPPLY_PRICING: SupplyPricingConfig = {
  takeRate: DEFAULT_TAKE_RATE,
  tiers: DEFAULT_TIERS,
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))

/** Sum a set of order lines into the supplier-price base (integer cents). */
export function supplyBaseCents(lines: { quantity: number; unitPriceCents: number }[]): number {
  return lines.reduce(
    (s, l) => s + Math.max(0, Math.round(l.unitPriceCents)) * Math.max(0, Math.round(l.quantity)),
    0,
  )
}

/** The HIGHEST tier whose volume threshold is met, or null (→ flat regime). */
export function applicableTier(
  volumeCents: number,
  tiers: readonly SupplyTier[] = DEFAULT_TIERS,
): SupplyTier | null {
  let best: SupplyTier | null = null
  for (const t of tiers) {
    if (volumeCents >= t.minVolumeCents && (!best || t.minVolumeCents > best.minVolumeCents)) best = t
  }
  return best
}

export interface SupplyEconomics {
  baseCents: number            // supplier-price subtotal (no markup)
  volumeCents: number          // volume used for tier determination
  regime: 'flat' | 'tier'
  takeRate: number             // applied only in 'flat'
  discountRate: number         // negotiated discount d (0 in 'flat')
  restoShareRate: number       // resto's share r (0 in 'flat')
  grubanoShareRate: number     // (d − r) in 'tier', takeRate in 'flat'
  restoPaysCents: number       // ≤ baseCents
  supplierPayoutCents: number  // what the supplier receives
  grubanoMarginCents: number   // = restoPays − supplierPayout (derived; ≥ 0)
  restoSavingsCents: number    // baseCents − restoPaysCents
}

/**
 * Compute the B2B economics for a supply order/line of base price `baseCents`,
 * with the tier chosen by `volumeCents` (defaults to `baseCents` for a single
 * order; a future group-buy caller may pass a larger aggregated volume). PURE —
 * no money moves. Integer cents; grubanoMargin is derived so the three sum exactly.
 */
export function computeSupplyEconomics(input: {
  baseCents: number
  volumeCents?: number
  config?: SupplyPricingConfig
}): SupplyEconomics {
  const cfg = input.config ?? DEFAULT_SUPPLY_PRICING
  const baseCents = Math.max(0, Math.round(input.baseCents))
  const volumeCents = Math.max(0, Math.round(input.volumeCents ?? baseCents))
  const tier = applicableTier(volumeCents, cfg.tiers)

  if (!tier) {
    // FLAT regime: resto pays the full supplier price; take-rate off the payout.
    const takeRate = clamp(cfg.takeRate, 0, 1)
    const supplierBorneCents = Math.round(baseCents * takeRate)
    const restoPaysCents = baseCents
    const supplierPayoutCents = baseCents - supplierBorneCents
    const grubanoMarginCents = restoPaysCents - supplierPayoutCents // = supplierBorneCents
    return {
      baseCents, volumeCents, regime: 'flat',
      takeRate, discountRate: 0, restoShareRate: 0, grubanoShareRate: takeRate,
      restoPaysCents, supplierPayoutCents, grubanoMarginCents, restoSavingsCents: 0,
    }
  }

  // TIER regime: the supplier grants the full discount d; the resto keeps r of it,
  // Grubano captures (d − r). The flat take-rate does NOT apply (anti-double-charge).
  const discountRate = clamp(tier.discountRate, 0, 1)
  const restoShareRate = clamp(tier.restoShareRate, 0, discountRate) // resto share ≤ discount
  const supplierBorneCents = Math.round(baseCents * discountRate)    // supplier grants full discount
  const restoDiscountCents = Math.round(baseCents * restoShareRate)  // resto's share off base
  const supplierPayoutCents = baseCents - supplierBorneCents
  const restoPaysCents = baseCents - restoDiscountCents
  const grubanoMarginCents = restoPaysCents - supplierPayoutCents    // = supplierBorne − restoDiscount (≥ 0)
  return {
    baseCents, volumeCents, regime: 'tier',
    takeRate: 0, discountRate, restoShareRate, grubanoShareRate: discountRate - restoShareRate,
    restoPaysCents, supplierPayoutCents, grubanoMarginCents, restoSavingsCents: baseCents - restoPaysCents,
  }
}
