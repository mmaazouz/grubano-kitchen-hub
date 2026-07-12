import { describe, it, expect } from 'vitest'
import { WEEKDAYS, isWeekday, normalizeWeekdays, isValidPeriod } from '@/lib/availability'

// ── lib/availability — pure constants + helpers (P4, Agent 77) ────────────────
// Simple declarative availability: weekdays + period validity. NO bookable slots.

describe('constants + guards', () => {
  it('has the 7 weekdays mon..sun in canonical order', () => {
    expect([...WEEKDAYS]).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  })
  it('isWeekday rejects unknown values', () => {
    expect(isWeekday('mon')).toBe(true)
    expect(isWeekday('sun')).toBe(true)
    expect(isWeekday('funday')).toBe(false)
  })
})

describe('normalizeWeekdays — canonical, unique, filtered', () => {
  it('keeps valid weekdays, drops junk + non-strings, de-dups, orders canonically', () => {
    expect(normalizeWeekdays(['fri', 'mon', 'mon', 'nope', 3, null])).toEqual(['mon', 'fri'])
    expect(normalizeWeekdays(['sun', 'wed', 'mon'])).toEqual(['mon', 'wed', 'sun'])
  })
  it('non-array input → []', () => {
    expect(normalizeWeekdays(null)).toEqual([])
    expect(normalizeWeekdays('mon')).toEqual([])
    expect(normalizeWeekdays(undefined)).toEqual([])
    expect(normalizeWeekdays({})).toEqual([])
  })
})

describe('isValidPeriod — both real dates, end on/after start', () => {
  it('valid when end >= start', () => {
    expect(isValidPeriod(new Date('2026-07-01'), new Date('2026-07-05'))).toBe(true)
    expect(isValidPeriod(new Date('2026-07-01'), new Date('2026-07-01'))).toBe(true)
  })
  it('invalid when end < start, or any date is NaN', () => {
    expect(isValidPeriod(new Date('2026-07-05'), new Date('2026-07-01'))).toBe(false)
    expect(isValidPeriod(new Date('not-a-date'), new Date('2026-07-01'))).toBe(false)
    expect(isValidPeriod(new Date('2026-07-01'), new Date('not-a-date'))).toBe(false)
  })
})
