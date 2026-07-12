// lib/pricing.ts — V1.5 pricing / margin primitives (PURE, env-overridable).
// Kept separate from lib/commission (the resto-commission rail) and lib/loyalty
// so the small-order fee and the shared net-margin base are composable and unit-
// tested in isolation. All money in INTEGER CENTS.

// ── Small-order fee ───────────────────────────────────────────────────────────
// A flat fee added when an order is too small to be worth fulfilling. Paid by the
// CLIENT, kept 100 % by GRUBANO (added to the application_fee) — it NEVER touches
// the resto's net, the commission base, the chef royalty, the loyalty credit or
// promos. The threshold is on the ITEMS SUBTOTAL at list price (before loyalty /
// fees / delivery) for a clear "commande sous X € de plats" rule.
export const DEFAULT_SMALL_ORDER_FEE_CENTS = 100        // 1,00 €
export const DEFAULT_SMALL_ORDER_THRESHOLD_CENTS = 1200 // 12,00 €

export function smallOrderFeeConfigCents(): number {
  const env = Number(process.env.SMALL_ORDER_FEE_CENTS)
  return Number.isFinite(env) && env >= 0 ? Math.floor(env) : DEFAULT_SMALL_ORDER_FEE_CENTS
}
export function smallOrderThresholdCents(): number {
  const env = Number(process.env.SMALL_ORDER_THRESHOLD_CENTS)
  return Number.isFinite(env) && env >= 0 ? Math.floor(env) : DEFAULT_SMALL_ORDER_THRESHOLD_CENTS
}

/** The small-order fee for an order whose ITEMS subtotal (list price, cents) is
 *  `itemsSubtotalCents`: the flat fee below the threshold, 0 at/above it. */
export function smallOrderFeeCents(itemsSubtotalCents: number): number {
  const sub = Math.max(0, Math.floor(itemsSubtotalCents))
  return sub < smallOrderThresholdCents() ? smallOrderFeeConfigCents() : 0
}

// ── Shared net-margin base (affiliation + loyalty cap) ────────────────────────
// Grubano's margin on an order BEFORE the influencer affiliation and the loyalty
// credit = commission − Stripe fee − creator royalty. V1.5: the affiliation earns
// a share of THIS net (not the gross commission), and the loyalty cap leaves
// Grubano the remainder — both rails draw from ONE positive base, so Grubano is
// never net-negative. Floored at 0. The small-order fee is NOT part of this base
// (it is separate Grubano revenue, never redistributed).
export function netBeforeAffiliateCents(commissionCents: number, stripeFeeCents: number, royaltyCents: number): number {
  return Math.max(
    0,
    Math.floor(commissionCents) - Math.max(0, Math.floor(stripeFeeCents)) - Math.max(0, Math.floor(royaltyCents)),
  )
}
