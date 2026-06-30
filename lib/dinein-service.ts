// ── G1 — Dine-in SERVICE CHARGE (frais de service sur l'addition à table) ──────
// Founder decision (FIXED): the dine-in service charge goes 100 % to the RESTO.
// It is the EXACT mirror of the ORDER delivery fee (resto-bound) and the OPPOSITE
// of the courier tip (platform-held). It is therefore:
//   • ADDED to the bill TOTAL (subtotal + service), charged to the customer ;
//   • NEVER part of the application_fee / commission BASE (the 5 % dine-in
//     commission stays on the FOOD subtotal only) ;
//   • flowed to the resto net (amount − fee), exactly like the delivery fee.
//
// Per-establishment configurable rate (Restaurant.dineInServiceRatePct, default
// 0 = no service). The whole feature is gated behind DINEIN_SERVICE_ENABLED so it
// deploys INERT: with the flag OFF (or the rate 0) serviceCents is ALWAYS 0 and
// every money path — bill total, dueCents, charge amount, application_fee,
// commission, the webhook ledger line — is BYTE-IDENTICAL to today.
//
// The service is NOT a stored ticket item: recomputeSubtotal stays FOOD-only and
// the service is derived at read/charge time from subtotal × rate (integer cents).

/** Feature flag — OFF by default (deploy inert). Mirrors isTipsEnabled(). */
export function isDineInServiceEnabled(): boolean {
  return process.env.DINEIN_SERVICE_ENABLED === 'true'
}

/** Service charge in integer CENTS for a food subtotal of `subtotalCents` at the
 *  establishment's `ratePct` (e.g. 0.10 = 10 %). Math.round at the cent, clamped
 *  ≥ 0. A null/0/negative rate yields 0 (no service). All maths in integer cents. */
export function dineInServiceCents(subtotalCents: number, ratePct: number | null | undefined): number {
  const rate = ratePct ?? 0
  if (!(rate > 0)) return 0
  return Math.max(0, Math.round(subtotalCents * rate))
}
