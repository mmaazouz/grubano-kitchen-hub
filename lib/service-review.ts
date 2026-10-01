// ── Service reviews — pure constants + helpers (P5, Agent 78) ─────────────────
// A restaurant rates a prestataire 1..5 AFTER a 'done' mission. PURE (no I/O) → unit-tested.
// SHARED by the review route, the fiche and the tests, so the rules are single-sourced.
// 100% OFF the money path — a review carries NO amount / charge / payout / commission.

export const RATING_MIN = 1
export const RATING_MAX = 5

export function isValidRating(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= RATING_MIN && n <= RATING_MAX
}

export interface ReviewAggregate { average: number; count: number }

/** Average rating rounded to 1 decimal + the count of (valid) ratings. Empty / all-invalid
 *  → { average: 0, count: 0 }. PURE + deterministic → unit-tested. */
export function computeAverage(ratings: number[]): ReviewAggregate {
  const valid = ratings.filter(isValidRating)
  if (valid.length === 0) return { average: 0, count: 0 }
  const sum = valid.reduce((s, r) => s + r, 0)
  return { average: Math.round((sum / valid.length) * 10) / 10, count: valid.length }
}
