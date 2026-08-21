// ── Customer avatar color (vague 3 — décision F) ──────────────────────────────
// Color per CUSTOMER, never per tier, never grey. Deterministically derived from
// LoyaltyCustomer.id (the cuid primary key) — NEVER from the displayed name
// (« Sophie M. » is ambiguous by construction). Same id → same color on every
// visit, on the LIST and on the FICHE (the two screens in scope — decision B).
//
// CLOSED, CYCLING palette — no infinite hue generation, collisions are fine
// (the color is a visual memory aid, not an identifier). Every gradient comes
// from the EXISTING charte: the six avatar gradients already shipped in the
// product's AV_GRADS (supplier/orders, supplier/livraisons) plus the blue pair
// of the op-customers CD mock (#2E78F0 is also the product's --op-info token).
// No grey, homogeneous saturation, white initials carried by the dark stop of
// each 135deg gradient — the exact pattern the product already uses.

// AA (décision CD 18/08, dérivation mécanique encadrée) : les familles orange,
// ambre, vert et violet sont ASSOMBRIES au minimum nécessaire (réduction de L en
// HSL, angle de teinte et direction du gradient conservés, pas de 1 point, k−1
// prouvé insuffisant au rendu réel) pour que le pire pixel réellement situé sous
// les initiales atteigne ≥ 4,5:1 en liste (14px/800, texte normal WCAG) :
// orange −19L · ambre −18L · vert −12L · violet −3L. Bleu, rouge et navy sont
// conformes d'origine et inchangés.
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
