// ── Customer avatar text containment (arbitrage Design 2026-08-19, option D) ──
// Adaptive reduction then clip. Nominal 14px (list) / 24px (profile), weight 800,
// white. If the INK rectangle overflows the safe zone inscribed in the circle:
// proportional reduction, re-measure, repeat; hard floor 11px / 18px; below the
// floor no further reduction — the circular clip (CSS overflow:hidden on the
// 50%-radius avatar) is the final net and is ALWAYS on, independent of fitting.
// Pure function: the caller provides measure(px) → ink extent, so the logic is
// unit-testable in Node without a DOM.

export type AvatarFitSpec = {
  nominal: number
  floor: number
  diameter: number
  /** marge de sécurité au bord du cercle (anti-aliasing), en px */
  safeMargin: number
}

export const AVATAR_FIT: Record<'list' | 'profile', AvatarFitSpec> = {
  list: { nominal: 14, floor: 11, diameter: 40, safeMargin: 1 },
  profile: { nominal: 24, floor: 18, diameter: 66, safeMargin: 1 },
}

export type InkExtent = { w: number; h: number }

/** Le rectangle d'encre (centré par le flex de l'avatar) tient dans le cercle sûr
 *  ssi son demi-diagonal ≤ rayon sûr. */
function fitsIn(ink: InkExtent, rSafe: number): boolean {
  return Math.hypot(ink.w / 2, ink.h / 2) <= rSafe
}

/** Taille de police retenue, déterministe (pas de 0,1 px, plancher dur). */
export function fitAvatarText(measure: (px: number) => InkExtent, spec: AvatarFitSpec): number {
  const rSafe = spec.diameter / 2 - spec.safeMargin
  let px = spec.nominal
  if (fitsIn(measure(px), rSafe)) return px
  for (let i = 0; i < 8 && px > spec.floor; i++) {
    const ink = measure(px)
    if (fitsIn(ink, rSafe)) break
    const factor = rSafe / Math.hypot(ink.w / 2, ink.h / 2)
    let next = Math.floor(px * factor * 10) / 10
    if (next >= px) next = Math.floor((px - 0.5) * 10) / 10
    px = Math.max(spec.floor, next)
  }
  return px
}
