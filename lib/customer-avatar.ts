// ── Customer avatar color (vague 3 — décision F) ──────────────────────────────
// Color per CUSTOMER, never per tier, never grey. Deterministically derived from
// LoyaltyCustomer.id (the cuid primary key) — NEVER from the displayed name
// (« Sophie M. » is ambiguous by construction). Same id → same color on every
// visit, on the LIST and on the FICHE (the two screens in scope — decision B).
//
// CLOSED, CYCLING palette — no infinite hue generation, collisions are fine
// (the color is a visual memory aid, not an identifier). The families ORIGINATE
// from the charte's avatar gradients (the product's AV_GRADS plus the blue pair
// of the customers mock) and were then adjusted for contrast — see below — so
// the stops are no longer byte-identical to those sources. No grey, homogeneous
// saturation, white initials on a 135deg gradient — the pattern the product uses.

// CONTRAST ADJUSTMENT (white initials on the gradient disc). Families whose
// lightest rendered disc pixel fell short of the acceptance threshold in force
// were darkened. The rule is NORMATIVE for any future darkening of a gradient:
//   - remove the SAME absolute amount of HSL lightness from BOTH stops
//     (additive, never a multiplicative factor): this preserves the gradient's
//     amplitude, whereas a factor would shrink it a little more at every pass;
//   - never adjust hue or saturation on purpose — any residual H/S drift in the
//     hex values below is 8-bit RGB quantisation only;
//   - keep the 135deg direction and the stop order (a family may legitimately
//     run light-to-dark the other way; do not "fix" it).
// Contrast is judged on the rendered disc itself, excluding the anti-aliased
// edge pixels composited with the page background, and each family gets the
// minimum darkening that passes. The stop values below are therefore the OUTPUT
// of that rule applied to the previous palette, not hand-picked colours:
// re-derive them with the same rule rather than editing hexes by eye.
export const CUSTOMER_AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#D25400,#8F3308)',
  'linear-gradient(135deg,#D5372A,#A8281D)',
  'linear-gradient(135deg,#AE7314,#5C3905)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#2F8A58,#136638)',
  'linear-gradient(135deg,#6248CB,#7F66DD)',
  'linear-gradient(135deg,#2A75F0,#1D54B4)',
] as const

/** Deterministic gradient for one customer — input is LoyaltyCustomer.id ONLY.
 *  Same ×31 rolling hash as the existing gradFor() of the charte. */
export function customerAvatarGradient(customerId: string): string {
  let h = 0
  for (let i = 0; i < customerId.length; i++) h = (h * 31 + customerId.charCodeAt(i)) >>> 0
  return CUSTOMER_AVATAR_GRADIENTS[h % CUSTOMER_AVATAR_GRADIENTS.length]
}
