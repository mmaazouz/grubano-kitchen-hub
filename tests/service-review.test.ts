import { describe, it, expect } from 'vitest'
import { RATING_MIN, RATING_MAX, isValidRating, computeAverage } from '@/lib/service-review'

// ── lib/service-review — pure rating validation + average (P5, Agent 78) ──────
// A review is 1..5. The fiche shows the average + count. NO money.

describe('rating bounds + guard', () => {
  it('bounds are 1..5', () => {
    expect(RATING_MIN).toBe(1)
    expect(RATING_MAX).toBe(5)
  })
  it('isValidRating accepts integers 1..5 only', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(isValidRating(n)).toBe(true)
    expect(isValidRating(0)).toBe(false)
    expect(isValidRating(6)).toBe(false)
    expect(isValidRating(3.5)).toBe(false)
    expect(isValidRating('4')).toBe(false)
    expect(isValidRating(null)).toBe(false)
    expect(isValidRating(NaN)).toBe(false)
  })
})

describe('computeAverage — rounded to 1 decimal, drops invalid', () => {
  it('empty → { average: 0, count: 0 }', () => {
    expect(computeAverage([])).toEqual({ average: 0, count: 0 })
  })
  it('averages and rounds to one decimal', () => {
    expect(computeAverage([5, 4, 4])).toEqual({ average: 4.3, count: 3 }) // 13/3 = 4.33 → 4.3
    expect(computeAverage([1, 2])).toEqual({ average: 1.5, count: 2 })
    expect(computeAverage([5, 5, 5, 5])).toEqual({ average: 5, count: 4 })
  })
  it('drops out-of-range / invalid ratings from the average AND the count', () => {
    expect(computeAverage([5, 0, 6, 3])).toEqual({ average: 4, count: 2 }) // only 5 + 3 are valid
  })
})
