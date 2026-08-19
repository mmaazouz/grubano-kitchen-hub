// Contention adaptative des avatars (arbitrage Design 2026-08-19, option D) :
// nominal → mesure d'encre → réduction proportionnelle → plancher 11/18 → le
// clip circulaire CSS (overflow:hidden) reste le filet inconditionnel.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AVATAR_FIT, fitAvatarText, type InkExtent } from '@/lib/avatar-fit'

/** encre simulée ∝ taille de police (facteur d'aspect du texte paramétré) */
const linearInk = (wPerPx: number, hPerPx: number) => (px: number): InkExtent => ({ w: wPerPx * px, h: hPerPx * px })

describe('fitAvatarText — liste (40px, nominal 14, plancher 11)', () => {
  it('texte nominal qui tient → aucune réduction', () => {
    // « MD » réel ≈ 24,5×10 px d'encre à 14px → 1,75/0,71 par px
    expect(fitAvatarText(linearInk(1.75, 0.71), AVATAR_FIT.list)).toBe(14)
  })

  it('texte large → réduction proportionnelle au-dessus du plancher', () => {
    // encre 2,9·px de large (≈ 40,6px à 14 → demi-diagonale 20,97 > 19) → réduit
    const px = fitAvatarText(linearInk(2.9, 0.75), AVATAR_FIT.list)
    expect(px).toBeLessThan(14)
    expect(px).toBeGreaterThanOrEqual(11)
    const ink = linearInk(2.9, 0.75)(px)
    expect(Math.hypot(ink.w / 2, ink.h / 2)).toBeLessThanOrEqual(19)
  })

  it('plusieurs niveaux de réduction selon la largeur', () => {
    const p1 = fitAvatarText(linearInk(2.8, 0.75), AVATAR_FIT.list)
    const p2 = fitAvatarText(linearInk(3.2, 0.75), AVATAR_FIT.list)
    const p3 = fitAvatarText(linearInk(3.6, 0.75), AVATAR_FIT.list)
    expect(p1).toBeGreaterThanOrEqual(p2)
    expect(p2).toBeGreaterThanOrEqual(p3)
    expect(p3).toBeLessThan(14)
  })

  it('cas extrêmement large → PLANCHER 11, jamais en dessous', () => {
    expect(fitAvatarText(linearInk(20, 1), AVATAR_FIT.list)).toBe(11)
    expect(fitAvatarText(linearInk(1000, 1), AVATAR_FIT.list)).toBe(11)
  })

  it('déterministe : même mesure → même taille', () => {
    const m = linearInk(2.7, 0.8)
    expect(fitAvatarText(m, AVATAR_FIT.list)).toBe(fitAvatarText(m, AVATAR_FIT.list))
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
