// lib/tips.ts — P2-TIP flags + helpers (PURE, env-gated). The consumer adds a
// COURIER tip at CHECKOUT; it is charged with the order (ONE charge), HELD by the
// platform (added to the application_fee — exactly like the small-order fee), and
// accrued as an obligation to the courier. It is NEVER resto revenue, NEVER in the
// commission base, NEVER earns loyalty points. All money in INTEGER CENTS.
//
// CENTRAL INVARIANT — gated by TIPS_ENABLED (default OFF):
//   OFF → the tip UI is hidden, POST /api/orders ignores any tipCents, and
//   /pay reads 0 → the charge amount, the application_fee, the commission, the
//   loyalty credit, every ledger line and the cart UI are ALL byte-identical to
//   today. The tip is a no-op until the flag is flipped on.

// ── Flags ──────────────────────────────────────────────────────────────────────

/** Kill-switch for the courier tip (UI + charge). Default OFF — only the exact
 *  string 'true' enables the rail. */
export function isTipsEnabled(): boolean {
  return process.env.TIPS_ENABLED === 'true'
}

// ── (P4.3 ÉTAPE 6) The phantom TIP_PAYOUT_ENABLED flag is REMOVED. The tip reversal rail
// now EXISTS: the held 'courier_tip' is reversed to the courier as a 100 % CourierEarning
// ('tip') at delivery (lib/courier-accrual.accrueCourierTipEarning) and paid out through
// payPartner('logistics'), all governed by LOGISTICS_PAYOUT_ENABLED. check-flags enforces
// TIPS_ENABLED ⇒ LOGISTICS_PAYOUT_ENABLED ⇒ LOGISTICS_CONNECT_ENABLED, so a tip can never be
// charged without a live reversal rail (fixes the D-1 held-funds hazard the old no-op masked).

// ── Caps ────────────────────────────────────────────────────────────────────────

/** The server-side cap on a tip, in cents (defensive — also enforced by the Zod
 *  z.number().int().min(0).max(50000) on the request). 50000 = 500,00 €. */
export const MAX_TIP_CENTS = 50000

/** Sanitise a client-sent tip amount to a safe integer-cents value in [0, MAX].
 *  A non-finite / negative / absent value collapses to 0 (no tip). */
export function sanitizeTipCents(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0
  return Math.min(MAX_TIP_CENTS, Math.max(0, Math.floor(raw)))
}
