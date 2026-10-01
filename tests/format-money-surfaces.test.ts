import { describe, it, expect } from 'vitest'
import { formatMoney, formatEuros, formatAmount } from '@/lib/format-money'

/**
 * Surface contract for the money-display migration (Agent 14).
 *
 * The design-system components (PriceTag, RestaurantCard, OrderCard) and the
 * migrated screens no longer format money themselves — they delegate to
 * lib/format-money. These tests lock the exact strings those surfaces render,
 * and the API decision that the app is EUR everywhere: the user's LANGUAGE
 * changes only the FORMAT, never the CURRENCY ($/AED was a bug).
 *
 * Node-only harness (no jsdom) → we assert the pure-function contract the
 * components are built on rather than rendering React.
 */

// FR/AR insert NBSP / narrow-NBSP around the symbol — normalise to plain space.
const norm = (s: string) => s.replace(/[   ]/g, ' ')

const SUPPORTED = ['fr', 'en', 'es', 'it', 'ar'] as const

describe('money surfaces — value & format contract', () => {
  it('PriceTag/Order/Restaurant euros: FR "12,50 €", EN "€12.50"', () => {
    expect(norm(formatEuros(12.5, 'fr'))).toBe('12,50 €')
    expect(norm(formatEuros(12.5, 'en'))).toBe('€12.50')
  })

  it('PriceTag cents (e.g. creator earnings / OrderCard cents): 1250 → "12,50 €" FR', () => {
    expect(norm(formatMoney(1250, 'fr'))).toBe('12,50 €')
    expect(norm(formatMoney(1250, 'en'))).toBe('€12.50')
  })

  it('hideCurrency / inside-€-translation uses formatAmount: number only, no symbol', () => {
    expect(norm(formatAmount(12.5, 'fr'))).toBe('12,50')
    expect(norm(formatAmount(12.5, 'en'))).toBe('12.50')
    expect(formatAmount(12.5, 'fr')).not.toContain('€')
  })

  it('noDecimals KPI (ConsolidatedHome fmtCur0): 12500 → "12 500 €" FR', () => {
    expect(norm(formatEuros(12500, 'fr', { noDecimals: true }))).toBe('12 500 €')
    expect(norm(formatEuros(12500, 'en', { noDecimals: true }))).toBe('€12,500')
  })

  it('CURRENCY is never driven by language: EUR symbol on every locale, never $ / AED', () => {
    for (const loc of SUPPORTED) {
      const out = formatEuros(12.5, loc)
      expect(out).toContain('€')
      expect(out).not.toContain('$')
      expect(out).not.toMatch(/AED|MAD|USD|د\.إ|د\.م/)
    }
  })
})
