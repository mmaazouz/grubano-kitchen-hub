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

export type LoyaltyCreditInput = {
  customerPointsBalance: number
  subtotalCents:         number
  /** Grubano's commission on this order (gross, computed on the FULL price). */
  commissionFeeCents:    number
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
  if (promoApplied || !requestedUsePoints) return { creditCents: 0, pointsSpent: 0 }

  // D5 — the three caps. ≤ commission guarantees the resulting application_fee
  // is never negative (Grubano waives at most its own commission, never more).
  const cap = Math.min(
    pointsToCents(customerPointsBalance),
    Math.max(0, subtotalCents),
    Math.max(0, commissionFeeCents),
  )
  if (cap <= 0) return { creditCents: 0, pointsSpent: 0 }

  // Spend WHOLE points only → the credit floors onto a point boundary ≤ cap.
  const pointsSpent = centsToPoints(cap)
  const creditCents = pointsToCents(pointsSpent)
  if (pointsSpent <= 0 || creditCents <= 0) return { creditCents: 0, pointsSpent: 0 }
  return { creditCents, pointsSpent }
}
