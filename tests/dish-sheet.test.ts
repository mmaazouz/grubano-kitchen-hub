import { describe, it, expect } from 'vitest'
import {
  sheetCompleteness, parseSheet, hasAllergenDeclaration, estimatedMarginPct,
  publicFace, businessFace,
  type DishSheet,
} from '@/lib/dish-sheet'
import { suggestAllergens } from '@/lib/allergen-suggest'

// ── Mission 6 — pure sheet logic ───────────────────────────────────────────────

const FULL: DishSheet = {
  baseServings: 4, prepMinutes: 20, cookMinutes: 15, difficulty: 'moyen',
  ingredients: [{ name: 'gnocchi', qty: 400, unit: 'g' }, { name: 'crème', qty: 20, unit: 'cl' }],
  steps: ['Pocher les gnocchis.', 'Monter la crème de truffe.', 'Dresser.'],
  allergens: ['gluten', 'lait'],
  dietTags: ['végétarien'],
  equipment: ['sauteuse'],
  platingNotes: 'Assiette creuse chaude, copeaux à la minute.',
  story: 'La recette du dimanche de ma nonna.',
  estimatedCostPerServing: 3.5,
}

describe('sheetCompleteness — a SCORE, never a blocker (D3)', () => {
  it('null sheet → 0', () => {
    expect(sheetCompleteness(null)).toBe(0)
  })

  it('a fully filled sheet reaches 100', () => {
    expect(sheetCompleteness(FULL)).toBe(100)
  })

  it('unquantified ingredient lines earn only their share of the 25 points', () => {
    const half = { ...FULL, ingredients: [
      { name: 'gnocchi', qty: 400, unit: 'g' },
      { name: 'crème', qty: null, unit: '' },   // not quantified
    ] }
    expect(sheetCompleteness(half)).toBe(100 - 12) // 25 → round(25 × 1/2) = 13 → loses 12
  })

  it('monotonic: removing allergens drops exactly their 15 points', () => {
    const { allergens: _a, ...rest } = FULL
    expect(sheetCompleteness(rest)).toBe(85)
  })
})

describe('parseSheet — tolerant of any Json shape', () => {
  it('garbage in → null, never a crash', () => {
    expect(parseSheet(null)).toBeNull()
    expect(parseSheet('string')).toBeNull()
    expect(parseSheet(42)).toBeNull()
    expect(parseSheet([1, 2])).toBeNull()
    expect(parseSheet({})).toBeNull()
  })

  it('keeps the recognisable subset, drops the junk', () => {
    const parsed = parseSheet({
      baseServings: 4, difficulty: 'extreme', steps: ['ok', 42, ''],
      allergens: ['lait', 'plutonium'], unknownKey: true,
      ingredients: [{ name: 'riz', qty: 'beaucoup', unit: 'g' }, { name: '' }, 'junk'],
    })
    expect(parsed).toEqual({
      baseServings: 4,
      steps: ['ok'],
      allergens: ['lait'],
      ingredients: [{ name: 'riz', qty: null, unit: 'g' }],
    })
  })

  it("'none' mixed with real allergens collapses to the real ones", () => {
    expect(parseSheet({ allergens: ['none', 'lait'] })?.allergens).toEqual(['lait'])
  })
})

describe('hasAllergenDeclaration — the D2 gate helper', () => {
  it('explicit none counts as a valid declaration', () => {
    expect(hasAllergenDeclaration({ allergens: ['none'] })).toBe(true)
  })
  it('absent or empty does not', () => {
    expect(hasAllergenDeclaration(null)).toBe(false)
    expect(hasAllergenDeclaration({})).toBe(false)
    expect(hasAllergenDeclaration({ allergens: [] })).toBe(false)
  })
})

describe('estimatedMarginPct — server-side business figure', () => {
  it('(price − cost) / price, rounded', () => {
    expect(estimatedMarginPct({ estimatedCostPerServing: 3.5 }, 14)).toBe(75)
  })
  it('null when not computable or absurd', () => {
    expect(estimatedMarginPct(null, 14)).toBeNull()
    expect(estimatedMarginPct({}, 14)).toBeNull()
    expect(estimatedMarginPct({ estimatedCostPerServing: 20 }, 14)).toBeNull() // cost > price
    expect(estimatedMarginPct({ estimatedCostPerServing: 3 }, 0)).toBeNull()
  })
})

describe('D1 — the public/business faces NEVER leak the asset', () => {
  it('publicFace exposes only story/diet/timings/difficulty', () => {
    expect(Object.keys(publicFace(FULL)!).sort()).toEqual(
      ['cookMinutes', 'dietTags', 'difficulty', 'prepMinutes', 'story'].sort())
  })

  it('businessFace exposes figures — no ingredients, steps or plating', () => {
    const face = businessFace(FULL, 14)
    expect(face).not.toHaveProperty('ingredients')
    expect(face).not.toHaveProperty('steps')
    expect(face).not.toHaveProperty('platingNotes')
    expect(face.sheetCompleteness).toBe(100)
    expect(face.estimatedMarginPct).toBe(75)
  })
})

describe('suggestAllergens — FR/EN keyword mapping toward the 14 INCO', () => {
  it('maps the classic kitchen words', () => {
    expect(suggestAllergens(['farine T55'])).toContain('gluten')
    expect(suggestAllergens(['crème fraîche'])).toContain('lait')
    expect(suggestAllergens(['crevettes roses'])).toContain('crustaces')
    expect(suggestAllergens(['shrimp paste'])).toContain('crustaces')
    expect(suggestAllergens(['sauce soja'])).toContain('soja')
    expect(suggestAllergens(['noisettes torréfiées'])).toContain('fruits_a_coque')
  })

  it('is accent/case tolerant and multi-ingredient', () => {
    const out = suggestAllergens(['CRÈME', 'Œuf bio', 'vin blanc'])
    expect(out).toEqual(expect.arrayContaining(['lait', 'oeufs', 'sulfites']))
  })

  it('no match → empty, never throws', () => {
    expect(suggestAllergens(['eau', 'sel'])).toEqual([])
    expect(suggestAllergens([])).toEqual([])
  })
})
