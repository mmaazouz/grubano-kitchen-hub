import { describe, it, expect } from 'vitest'
import {
  SERVICE_CATEGORIES, SERVICE_MODALITIES, isServiceCategory, isServiceModality,
  asStringArray, offeringMatchesCategory, zonesMatch, filterPrestataires,
} from '@/lib/service-offering'

// ── lib/service-offering — pure constants + discovery filter (P2, Agent 75) ───
// The single source of the category/zone discovery logic shared by the API + the page.

describe('constants + type guards', () => {
  it('exposes the 10 service trades + 3 modalities', () => {
    expect(SERVICE_CATEGORIES.length).toBe(10)
    expect(SERVICE_CATEGORIES).toContain('haccp')
    expect(SERVICE_CATEGORIES).toContain('fridge_repair')
    expect(SERVICE_MODALITIES).toEqual(['on_site', 'remote', 'both'])
  })
  it('guards reject unknown values', () => {
    expect(isServiceCategory('haccp')).toBe(true)
    expect(isServiceCategory('nope')).toBe(false)
    expect(isServiceModality('remote')).toBe(true)
    expect(isServiceModality('teleport')).toBe(false)
  })
})

describe('asStringArray — Json column coercion', () => {
  it('keeps strings, drops non-strings, [] for non-arrays', () => {
    expect(asStringArray(['a', 1, 'b', null, {}])).toEqual(['a', 'b'])
    expect(asStringArray(null)).toEqual([])
    expect(asStringArray('garbage')).toEqual([])
    expect(asStringArray(undefined)).toEqual([])
  })
})

describe('offeringMatchesCategory / zonesMatch', () => {
  const offs = [{ category: 'haccp' }, { category: 'cleaning' }]
  it('category: empty/null matches all; exact case-insensitive otherwise', () => {
    expect(offeringMatchesCategory(offs, '')).toBe(true)
    expect(offeringMatchesCategory(offs, null)).toBe(true)
    expect(offeringMatchesCategory(offs, 'HACCP')).toBe(true)
    expect(offeringMatchesCategory(offs, 'plumbing')).toBe(false)
    expect(offeringMatchesCategory([], 'haccp')).toBe(false)
  })
  it('zone: empty matches all; case-insensitive SUBSTRING', () => {
    expect(zonesMatch(['Lyon', '69003'], '')).toBe(true)
    expect(zonesMatch(['Lyon'], 'lyo')).toBe(true)
    expect(zonesMatch(['69003'], '690')).toBe(true)
    expect(zonesMatch(['Lyon'], 'paris')).toBe(false)
    expect(zonesMatch([], 'lyon')).toBe(false)
  })
})

describe('filterPrestataires — AND of category + zone', () => {
  const list = [
    { id: 'a', coverageZones: ['Lyon', '69003'], serviceOfferings: [{ category: 'fridge_repair' }] },
    { id: 'b', coverageZones: ['Paris', '75'],    serviceOfferings: [{ category: 'haccp' }] },
  ]
  const ids = (r: typeof list) => r.map((p) => p.id)

  it('no filters → unchanged', () => {
    expect(ids(filterPrestataires(list, {}))).toEqual(['a', 'b'])
  })
  it('category filter', () => {
    expect(ids(filterPrestataires(list, { category: 'haccp' }))).toEqual(['b'])
  })
  it('zone filter (substring, case-insensitive)', () => {
    expect(ids(filterPrestataires(list, { zone: 'lyon' }))).toEqual(['a'])
  })
  it('combined filters are ANDed → may be empty', () => {
    expect(filterPrestataires(list, { category: 'haccp', zone: 'lyon' })).toEqual([])
    expect(ids(filterPrestataires(list, { category: 'fridge_repair', zone: '690' }))).toEqual(['a'])
  })
})
