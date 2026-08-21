// Contention adaptative des avatars (arbitrage Design 2026-08-19, option D) :
// nominal → mesure d'encre → réduction proportionnelle → plancher 11/18 → le
// clip circulaire CSS (overflow:hidden) reste le filet inconditionnel.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AVATAR_FIT, fitAvatarText, type InkExtent } from '@/lib/avatar-fit'

/** encre simulée ∝ taille de police (facteur d'aspect du texte paramétré) */
const linearInk = (wPerPx: number, hPerPx: number) => (px: number): InkExtent => ({ w: wPerPx * px, h: hPerPx * px })

describe('fitAvatarText — liste (32px, nominal 11,5, plancher 11)', () => {
  const S = AVATAR_FIT.list
  const rSafe = S.diameter / 2 - S.safeMargin

  it('spec de la liste : diamètre 32, nominal 11,5, plancher 11 (décision CD 20/08)', () => {
    expect(S).toEqual({ nominal: 11.5, floor: 11, diameter: 32, safeMargin: 1 })
  })

  it('texte nominal qui tient → aucune réduction', () => {
    // « MD » réel ≈ 17,2 × 7,8 px d'encre à 11,5px → 1,50/0,68 par px
    expect(fitAvatarText(linearInk(1.5, 0.68), S)).toBe(11.5)
  })

  it('texte large → réduction, jamais sous le plancher, et l encre rentre', () => {
    const px = fitAvatarText(linearInk(2.55, 0.71), S)
    expect(px).toBeLessThan(11.5)
    expect(px).toBeGreaterThanOrEqual(11)
    const ink = linearInk(2.55, 0.71)(px)
    expect(Math.hypot(ink.w / 2, ink.h / 2)).toBeLessThanOrEqual(rSafe)
  })

  it('plusieurs niveaux de réduction selon la largeur (course 11,5 → 11)', () => {
    const p1 = fitAvatarText(linearInk(2.55, 0.71), S)
    const p2 = fitAvatarText(linearInk(2.6, 0.71), S)
    const p3 = fitAvatarText(linearInk(2.9, 0.71), S)
    expect(p1).toBeGreaterThanOrEqual(p2)
    expect(p2).toBeGreaterThanOrEqual(p3)
    expect(p3).toBeLessThan(11.5)
  })

  it('cas extrêmement large → PLANCHER 11, jamais en dessous', () => {
    expect(fitAvatarText(linearInk(20, 1), S)).toBe(11)
    expect(fitAvatarText(linearInk(1000, 1), S)).toBe(11)
  })

  it('le clip reste le filet : au plancher, l encre PEUT encore dépasser', () => {
    // ǄǄ mesuré : encre ≈ 2,72·px de large → au plancher 11 px elle dépasse
    const px = fitAvatarText(linearInk(2.72, 0.91), S)
    expect(px).toBe(11)
    const ink = linearInk(2.72, 0.91)(px)
    expect(Math.hypot(ink.w / 2, ink.h / 2)).toBeGreaterThan(rSafe)
  })

  it('déterministe : même mesure → même taille', () => {
    const m = linearInk(2.7, 0.8)
    expect(fitAvatarText(m, S)).toBe(fitAvatarText(m, S))
  })
})

describe('fitAvatarText — fiche (66px, nominal 24, plancher 18)', () => {
  it('nominal qui tient → 24', () => {
    expect(fitAvatarText(linearInk(1.75, 0.71), AVATAR_FIT.profile)).toBe(24)
  })

  it('large → réduit, ≥ 18, et tient dans le cercle sûr', () => {
    const px = fitAvatarText(linearInk(2.6, 0.75), AVATAR_FIT.profile)
    expect(px).toBeLessThan(24)
    expect(px).toBeGreaterThanOrEqual(18)
    const ink = linearInk(2.6, 0.75)(px)
    expect(Math.hypot(ink.w / 2, ink.h / 2)).toBeLessThanOrEqual(32)
  })

  it('extrême → plancher 18 exactement', () => {
    expect(fitAvatarText(linearInk(50, 2), AVATAR_FIT.profile)).toBe(18)
  })
})

describe('clip circulaire — filet final inconditionnel (CSS)', () => {
  const root = join(__dirname, '..')
  it('.lc__av (liste) : overflow hidden + border-radius 50%', () => {
    const css = readFileSync(join(root, 'app/[locale]/customers/customers.css'), 'utf8')
    const rule = css.match(/\.cl-root \.lc__av\{[^}]+\}/)?.[0] ?? ''
    expect(rule).toContain('overflow:hidden')
    expect(rule).toContain('border-radius:50%')
  })
  it('.hero__av (fiche) : overflow hidden + border-radius 50%', () => {
    const css = readFileSync(join(root, 'app/[locale]/customers/[id]/customer-profile.css'), 'utf8')
    const rule = css.match(/\.cp-root \.hero__av\{[^}]+\}/)?.[0] ?? ''
    expect(rule).toContain('overflow:hidden')
    expect(rule).toContain('border-radius:50%')
  })
})
