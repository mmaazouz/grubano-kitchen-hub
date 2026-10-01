// lib/service-pricing.ts — SERVICES economics engine (PURE, P6, Agent 79).
//
// SEPARATE from every other rail (lib/supply-pricing, lib/pricing, lib/commission, lib/ledger,
// lib/creator-payout, lib/partner-balance, affiliation) — it NEVER imports or touches them.
// No I/O, no Stripe, NO money movement: it takes the agreed quote amount and RETURNS amounts
// (INTEGER CENTS). P7 (the payment slice) will CONSUME these numbers as the application_fee;
// this module decides nothing about WHEN or HOW money actually moves.
//
// ── ECONOMICS (Mohammed) ─────────────────────────────────────────────────────
//  - The restaurant pays the AGREED quote amount (no markup): restaurantPaysCents = quote.
//  - Grubano keeps a flat SERVICE COMMISSION (default 5%) on the prestataire side:
//    grubanoMarginCents = round(quote × rate).
//  - The prestataire nets the rest: prestataireNetCents = quote − grubanoMarginCents.
//
// ── CONSERVATION (invariant) ─────────────────────────────────────────────────
//   restaurantPaysCents === prestataireNetCents + grubanoMarginCents   (ALWAYS, exact)
// grubanoMargin is the ONLY rounded amount; prestataireNet is DERIVED as the difference →
// the three sum exactly with NO rounding drift, for ANY quote and ANY rate.

export const SERVICE_COMMISSION_RATE = 0.05 // 5% — flat, on the prestataire payout

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

export interface ServiceEconomics {
  rate: number                 // the commission rate applied
  restaurantPaysCents: number  // = the agreed quote amount (no markup)
  grubanoMarginCents: number   // round(quote × rate) — Grubano's service commission
  prestataireNetCents: number  // = restaurantPays − grubanoMargin (derived; ≥ 0)
}

/** Compute the SERVICE economics for an agreed quote of `quoteAmountCents`. PURE — no money
 *  moves. Integer cents; grubanoMargin is rounded, prestataireNet is DERIVED so the two always
 *  re-add to restaurantPays exactly. Negative / non-finite input → treated as 0; rate clamped
 *  to [0, 1]. This is the same shape lib/supply-pricing returns (separate engine, 5% flat). */
export function computeServiceEconomics(
  quoteAmountCents: number,
  rate: number = SERVICE_COMMISSION_RATE,
): ServiceEconomics {
  const amount = Math.max(0, Math.round(Number.isFinite(quoteAmountCents) ? quoteAmountCents : 0))
  const r = clamp01(rate)
  const grubanoMarginCents = Math.round(amount * r)
  const prestataireNetCents = amount - grubanoMarginCents // derived → invariant always exact
  return { rate: r, restaurantPaysCents: amount, grubanoMarginCents, prestataireNetCents }
}
