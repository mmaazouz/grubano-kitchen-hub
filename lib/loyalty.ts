// Loyalty redemption engine (chantier fidélité L1) — PURE + exhaustively tested.
//
// DOCTRINE this module enforces:
//   D2 loyalty NEVER goes through the promo engine — it is GRUBANO-financed
//      (the commission stays on the full price), the opposite of a promo;
//   D3 promo-exclusive: a promo on the order → loyalty is not applicable;
//   D4 the client sends an INTENTION (usePoints), the SERVER computes the euros;
//   D5 the credit is capped so Grubano can WAIVE its commission, never advance:
//      credit ≤ subtotal, ≤ converted balance, AND ≤ Grubano's commission.
// All money in INTEGER CENTS, points are WHOLE (no float, no rounding drift).

// Scale (env-overridable): 100 pts = 5,00 € → 5 cents/point.
export const DEFAULT_CENTS_PER_POINT = 5

export function centsPerPoint(): number {
  const env = Number(process.env.LOYALTY_CENTS_PER_POINT)
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : DEFAULT_CENTS_PER_POINT
}

/** Whole points → cents (floors fractional point inputs defensively). */
export function pointsToCents(points: number): number {
  return Math.max(0, Math.floor(points)) * centsPerPoint()
}

/** Cents → the number of WHOLE points needed to cover them (floor — we never
 *  spend a fractional point, so the credit lands on a point boundary ≤ cents). */
export function centsToPoints(cents: number): number {
  return Math.floor(Math.max(0, cents) / centsPerPoint())
}

// ── Stripe fee estimation (borne de sécurité — phase 0) ───────────────────────
// The REAL Stripe fee is only known post-settlement (webhook → balance txn →
// ledger.stripeFeeAmount). Payments are DESTINATION charges, so Grubano bears the
// Stripe fee (the resto nets charge − commission = plein). At credit-resolution
// time we ESTIMATE it CONSERVATIVELY (over-estimate = tighter cap = safe), on the
// FULL charge before any credit. Env-overridable to the real Stripe contract:
// STRIPE_FEE_PCT (default 2.9 %) + STRIPE_FEE_FIXED_CENTS (default 25).
export const DEFAULT_STRIPE_FEE_PCT = 0.029
export const DEFAULT_STRIPE_FEE_FIXED_CENTS = 25

export function stripeFeePct(): number {
  const env = Number(process.env.STRIPE_FEE_PCT)
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_STRIPE_FEE_PCT
}
export function stripeFeeFixedCents(): number {
  const env = Number(process.env.STRIPE_FEE_FIXED_CENTS)
  return Number.isFinite(env) && env >= 0 ? Math.floor(env) : DEFAULT_STRIPE_FEE_FIXED_CENTS
}

/** Conservative Stripe-fee estimate for a charge of `chargeCents`. Pass the FULL
 *  charge (subtotal + delivery, before any loyalty credit) → highest → safe cap. */
export function estimateStripeFeeCents(chargeCents: number): number {
  const c = Math.max(0, Math.floor(chargeCents))
  return Math.round(c * stripeFeePct()) + stripeFeeFixedCents()
}

// ── Committed creator royalty (mirrors the FROZEN DishSale 5C formula) ────────
// READ-ONLY sizing for the loyalty cap: per adopted line, creatorEarning =
// round2(lineAmountEuros × rate); summed → cents. This DELIBERATELY duplicates the
// DishSale math (api/orders) — that block stays the single writer and is untouched;
// keep the two in sync. `rate` is the per-line referred/organic tier the caller
// resolved (a sale of a creator's OWN recipe from their OWN referral traffic earns
// the referred tier, else the organic tier — both default 2 %).
export function committedRoyaltyCents(lines: { amountCents: number; rate: number }[]): number {
  let totalCents = 0
  for (const l of lines) {
    const amountEuros  = Math.max(0, l.amountCents) / 100
    const earningEuros = Math.round(amountEuros * Math.max(0, l.rate) * 100) / 100 // round2, mirrors DishSale
    totalCents += Math.round(earningEuros * 100)
  }
  return totalCents
}

export type LoyaltyCreditInput = {
  customerPointsBalance: number
  subtotalCents:         number
  /** Grubano's commission on this order (gross, computed on the FULL price). */
  commissionFeeCents:    number
  /** Other claims already drawn from that SAME commission on this order, in cents:
   *  the estimated Stripe fee (destination charge) + the creator royalty (DishSale)
   *  + the influencer affiliation (ReferralOrder). Default 0. The credit cap
   *  subtracts these so Grubano's margin (commission − claims − credit) is never
   *  < 0 (D-A, STRICT). */
  committedClaimsCents?: number
  /** D3: a promo applies to the order → loyalty is not applicable. */
  promoApplied:          boolean
  /** D4: the customer's intention ("use my points"). */
  requestedUsePoints:    boolean
}

/** Resolve the loyalty credit for an order. Returns whole points + the matching
 *  cents. {0,0} when a promo applies (D3), when not requested (D4), or when no
 *  cap allows a ≥ 1-point credit. */
export function resolveLoyaltyCredit(opts: LoyaltyCreditInput): { creditCents: number; pointsSpent: number } {
  const { customerPointsBalance, subtotalCents, commissionFeeCents, promoApplied, requestedUsePoints } = opts
  const committedClaimsCents = Math.max(0, opts.committedClaimsCents ?? 0)
  if (promoApplied || !requestedUsePoints) return { creditCents: 0, pointsSpent: 0 }

  // D5 / D-A — the three caps. The commission cap is now commission MINUS the
  // Stripe fee + creator royalty + affiliation already drawn on this order, so the
  // credit can waive at most Grubano's REMAINING margin: margin = commission −
  // claims − credit ≥ 0. Grubano can break even (0), never go net-negative. The
  // other two caps (converted balance, subtotal) are unchanged.
  const cap = Math.min(
    pointsToCents(customerPointsBalance),
    Math.max(0, subtotalCents),
    Math.max(0, commissionFeeCents - committedClaimsCents),
  )
  if (cap <= 0) return { creditCents: 0, pointsSpent: 0 }

  // Spend WHOLE points only → the credit floors onto a point boundary ≤ cap.
  const pointsSpent = centsToPoints(cap)
  const creditCents = pointsToCents(pointsSpent)
  if (pointsSpent <= 0 || creditCents <= 0) return { creditCents: 0, pointsSpent: 0 }
  return { creditCents, pointsSpent }
}
