import { describe, it, expect } from 'vitest'
import { eurosToCents, normalizeAllergens, parseCatalogCsv } from '@/lib/supplier-catalog'

// ── Supplier catalogue pure helpers (B2B Slice 1, Agent 14) ───────────────────
// Money boundary (euros↔cents) + CSV import parsing. Pure → node harness.

describe('eurosToCents', () => {
  it('converts numbers and strings (comma / point / €) to integer cents', () => {
    expect(eurosToCents(12.5)).toBe(1250)
    expect(eurosToCents('12,50')).toBe(1250)
    expect(eurosToCents('12.50 €')).toBe(1250)
    expect(eurosToCents('0')).toBe(0)
    expect(eurosToCents(0)).toBe(0)
  })
  it('rejects invalid / negative / empty', () => {
    expect(eurosToCents('abc')).toBeNull()
    expect(eurosToCents('')).toBeNull()
    expect(eurosToCents(-1)).toBeNull()
    expect(eurosToCents(Number.NaN)).toBeNull()
  })
})

describe('normalizeAllergens', () => {
  it('keeps valid INCO ids + none, drops unknowns, dedupes', () => {
    expect(normalizeAllergens(['gluten', 'lait', 'gluten', 'xyz'])).toEqual(['gluten', 'lait'])
    expect(normalizeAllergens(['NONE'])).toEqual(['none'])
    expect(normalizeAllergens('nope')).toEqual([])
  })
})

describe('parseCatalogCsv', () => {
  it('parses valid rows, converts price → cents, defaults unit/category/available', () => {
    const csv = 'name,price,unit,category\nTomates,2.50,kg,Légumes\nLait,1,L,Crémerie'
    const r = parseCatalogCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.valid).toHaveLength(2)
    expect(r.valid[0]).toMatchObject({ name: 'Tomates', priceCents: 250, unit: 'kg', category: 'Légumes', available: true })
    expect(r.valid[1]).toMatchObject({ name: 'Lait', priceCents: 100, unit: 'L', category: 'Crémerie' })
  })

  it('reports invalid rows (missing name, bad price, unknown unit) WITHOUT creating them', () => {
    const csv = 'name,price,unit\n,5,kg\nSel,abc,kg\nPoivre,3,tonne'
    const r = parseCatalogCsv(csv)
    expect(r.valid).toHaveLength(0)
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]) // header = line 1
  })

  it('flags in-file duplicate names (kept once)', () => {
    const r = parseCatalogCsv('name,price\nPain,1\nPain,2')
    expect(r.valid).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/Doublon/)
  })

  it('honours quoted fields with commas + parses ;-separated allergens', () => {
    const csv = 'name,price,allergens\n"Quiche, lorraine",6.90,gluten;oeufs;lait'
    const r = parseCatalogCsv(csv)
    expect(r.valid[0].name).toBe('Quiche, lorraine')
    expect(r.valid[0].priceCents).toBe(690)
    expect(r.valid[0].allergens).toEqual(['gluten', 'oeufs', 'lait'])
  })

  it('default unit is piece when the column is blank', () => {
    expect(parseCatalogCsv('name,price,unit\nOeuf,0.30,').valid[0].unit).toBe('piece')
  })

  it('keeps ORIGINAL line numbers when blank lines are present', () => {
    const csv = 'name,price\nPain,1\n\n,5' // blank line 3; invalid row at the user's line 4
    const r = parseCatalogCsv(csv)
    expect(r.valid).toHaveLength(1)
    expect(r.errors).toEqual([{ line: 4, message: 'Nom manquant.' }])
  })

  it('errors on a header missing name/price, and on an empty file', () => {
    expect(parseCatalogCsv('foo,bar\n1,2').errors[0].message).toMatch(/En-tête/)
    expect(parseCatalogCsv('').errors).toHaveLength(1)
  })
})
