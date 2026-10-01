import { describe, it, expect } from 'vitest'
import { resolveVatRate, DEFAULT_VAT_COUNTRY } from '@/lib/tax'
import { splitTtc, issuerIdentity } from '@/lib/invoice'
import { LEGAL_INFO, isPlaceholder } from '@/lib/legal-info'

// ── P4.4-A — per-country VAT resolver + FR byte-identical invoice split ──────────

describe('resolveVatRate — per-country, France default', () => {
  it('(a) FR = 0.20 (authoritative — the former hardcoded rate)', () => {
    expect(resolveVatRate('FR')).toBe(0.20)
    expect(DEFAULT_VAT_COUNTRY).toBe('FR')
  })
  it('(b) case-insensitive + trimmed', () => {
    expect(resolveVatRate('fr')).toBe(0.20)
    expect(resolveVatRate(' FR ')).toBe(0.20)
  })
  it('(b) other configured countries resolve to their rate', () => {
    expect(resolveVatRate('DE')).toBe(0.19)
    expect(resolveVatRate('IT')).toBe(0.22)
    expect(resolveVatRate('ES')).toBe(0.21)
  })
  it('(b) unknown / null / undefined → FR default (documented, can never blow up)', () => {
    expect(resolveVatRate('ZZ')).toBe(0.20)
    expect(resolveVatRate(null)).toBe(0.20)
    expect(resolveVatRate(undefined)).toBe(0.20)
    expect(resolveVatRate('')).toBe(0.20)
  })
})

describe('splitTtc — (a) FR byte-identical + (b) per-country', () => {
  it('FR (default) reproduces the legacy split EXACTLY (HT = round(ttc/1.2))', () => {
    expect(splitTtc(120)).toEqual({ htCents: 100, tvaCents: 20 })
    expect(splitTtc(1200)).toEqual({ htCents: 1000, tvaCents: 200 })
    expect(splitTtc(100)).toEqual({ htCents: 83, tvaCents: 17 })
  })
  it('the default arg === explicit FR for every amount (no behaviour drift)', () => {
    for (const ttc of [0, 1, 99, 600, 7777, 12_345, 999_999]) {
      expect(splitTtc(ttc)).toEqual(splitTtc(ttc, 'FR'))
    }
  })
  it('a non-FR country uses ITS rate (DE 19%): HT = round(ttc/1.19)', () => {
    expect(splitTtc(1190, 'DE')).toEqual({ htCents: 1000, tvaCents: 190 })
    for (const ttc of [1, 100, 12_345]) {
      const s = splitTtc(ttc, 'DE')
      expect(s.htCents + s.tvaCents).toBe(ttc) // identity holds for any rate
    }
  })
})

describe('issuerIdentity — sourced from lib/legal-info (single source, guard-rail intact)', () => {
  it('returns the legal-info editor facts verbatim (placeholders today)', () => {
    const i = issuerIdentity()
    expect(i.name).toBe(LEGAL_INFO.editor.raisonSociale)
    expect(i.address).toBe(LEGAL_INFO.editor.siegeAdresse)
    expect(i.siren).toBe(LEGAL_INFO.editor.siren)
    expect(i.vat).toBe(LEGAL_INFO.editor.tvaIntra)
    // shown verbatim → it IS a placeholder (we do not bypass / fake completeness)
    expect(isPlaceholder(i.siren)).toBe(true)
  })
})
