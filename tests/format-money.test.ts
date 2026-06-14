import { describe, it, expect } from 'vitest'
import { formatMoney, formatEuros, formatAmount } from '@/lib/format-money'

// Normalize the various Unicode spaces ICU uses around the FR currency symbol
// (NBSP U+00A0 / narrow NBSP U+202F) to a plain space so assertions are stable
// across Node/ICU versions.
const norm = (s: string) => s.replace(/[  ]/g, ' ')

describe('formatMoney (cents → localized EUR, DISPLAY only)', () => {
  it('FR: comma decimal, symbol after, space', () => {
    expect(norm(formatMoney(1250, 'fr'))).toBe('12,50 €')
    expect(norm(formatMoney(0, 'fr'))).toBe('0,00 €')
    expect(norm(formatMoney(1, 'fr'))).toBe('0,01 €')
  })

  it('EN: dot decimal, symbol first (still EUR — never $)', () => {
    expect(norm(formatMoney(1250, 'en'))).toBe('€12.50')
    expect(norm(formatMoney(999999, 'en'))).toBe('€9,999.99')
  })

  it('large amounts get a thousands separator (FR)', () => {
    expect(norm(formatMoney(999999, 'fr'))).toBe('9 999,99 €')
    expect(norm(formatMoney(123456789, 'fr'))).toBe('1 234 567,89 €')
  })

  it('exact cents — never floating drift', () => {
    expect(norm(formatMoney(833, 'fr'))).toBe('8,33 €')   // not 8.333…
    expect(norm(formatMoney(1999, 'fr'))).toBe('19,99 €')
  })

  it('noDecimals option (round KPI figures)', () => {
    expect(norm(formatMoney(1250000, 'fr', { noDecimals: true }))).toBe('12 500 €')
  })

  it('tolerant of non-finite input → 0', () => {
    expect(norm(formatMoney(Number.NaN, 'fr'))).toBe('0,00 €')
  })

  it('unknown locale falls back to fr-FR', () => {
    expect(norm(formatMoney(1250, 'zz'))).toBe('12,50 €')
  })
})

describe('formatEuros (value already in euros)', () => {
  it('formats a euro Float without dividing', () => {
    expect(norm(formatEuros(12.5, 'fr'))).toBe('12,50 €')
    expect(norm(formatEuros(8.333, 'fr'))).toBe('8,33 €') // rounds to 2dp for display
    expect(norm(formatEuros(12.5, 'en'))).toBe('€12.50')
  })
})

describe('formatAmount (number only — for "{amount} €" translations, no double symbol)', () => {
  it('localized decimal, NO currency symbol', () => {
    expect(norm(formatAmount(12.5, 'fr'))).toBe('12,50')   // → "12,50 € de crédit"
    expect(norm(formatAmount(12.5, 'en'))).toBe('12.50')
    expect(norm(formatAmount(1234.5, 'fr'))).toBe('1 234,50')
    expect(formatAmount(12.5, 'fr')).not.toContain('€')
  })
})
