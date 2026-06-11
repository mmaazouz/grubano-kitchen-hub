// tests/finance-invoice.test.ts — Agent 1 / A6 gardiens.
// Pure unit tests for lib/invoice.ts: splits + month bounds.
//
// We import ONLY the pure helpers (splitTtc, monthBounds, VAT_RATE) — those do
// not touch Prisma. issueInvoice (the transactional one) is integration-tested
// elsewhere through the existing routes; here we lock down the math.

import { describe, it, expect } from 'vitest'
import { splitTtc, monthBounds, VAT_RATE } from '@/lib/invoice'

describe('VAT_RATE — frozen at A0-bis default', () => {
  it('is the French standard rate on services (20 %)', () => {
    expect(VAT_RATE).toBe(0.20)
  })
})

describe('splitTtc — HT + TVA always sums back to TTC, cent-exact', () => {
  // The split is HT = round(ttc / 1.2), TVA = ttc − HT. By construction the
  // sum equals ttc — but we re-verify it as a PROPERTY across a wide range
  // so any future refactor that drops the "TVA = ttc − HT" identity gets caught.

  it('handles 0', () => {
    expect(splitTtc(0)).toEqual({ htCents: 0, tvaCents: 0 })
  })

  it('handles 1 cent (degenerate but legal)', () => {
    const { htCents, tvaCents } = splitTtc(1)
    expect(htCents + tvaCents).toBe(1)
  })

  it('handles 120 cents exactly (HT 100, TVA 20)', () => {
    expect(splitTtc(120)).toEqual({ htCents: 100, tvaCents: 20 })
  })

  it('handles a typical commission cent value (12 €)', () => {
    // 1200 / 1.2 = 1000 exactly → HT 1000c, TVA 200c
    expect(splitTtc(1200)).toEqual({ htCents: 1000, tvaCents: 200 })
  })

  it('preserves identity on a non-exact division (rounding side trapped in TVA)', () => {
    // 100c TTC → 100/1.2 = 83.333… → HT 83, TVA 17. 83 + 17 = 100. Identity holds.
    expect(splitTtc(100)).toEqual({ htCents: 83, tvaCents: 17 })
  })

  it('property: HT + TVA === TTC for every TTC in [0, 100 000]', () => {
    // Walk the full range of plausible monthly invoice TTC values (up to 1 000 €
    // worth of cents). We don't need 100 % coverage — but every step proves
    // the identity holds at every boundary. If the math ever drifts, this test
    // pinpoints the smallest failing input.
    for (let ttc = 0; ttc <= 100_000; ttc++) {
      const { htCents, tvaCents } = splitTtc(ttc)
      if (htCents + tvaCents !== ttc) {
        // Fail with a useful message rather than thousands of expect() calls.
        throw new Error(`identity broken at ttc=${ttc}: ht=${htCents} tva=${tvaCents} sum=${htCents + tvaCents}`)
      }
    }
  })

  it('property: holds on a few extreme amounts', () => {
    for (const ttc of [1, 99, 100, 599, 600, 12_345, 999_999, 10_000_000]) {
      const { htCents, tvaCents } = splitTtc(ttc)
      expect(htCents + tvaCents).toBe(ttc)
      expect(htCents).toBeGreaterThanOrEqual(0)
      expect(tvaCents).toBeGreaterThanOrEqual(0)
    }
  })

  it('TVA is roughly TTC × 20/120 (sanity bound; exact value drops the fractional cent on HT)', () => {
    // 1000c → HT 833, TVA 167. TTC * 20/120 = 166.67. TVA differs by ≤ 1c.
    for (const ttc of [1000, 5000, 7777, 12_345, 1_000_000]) {
      const { tvaCents } = splitTtc(ttc)
      const ideal = ttc * 20 / 120
      expect(Math.abs(tvaCents - ideal)).toBeLessThanOrEqual(1)
    }
  })
})

describe('monthBounds — strict format + UTC boundaries', () => {
  it('returns null on a bad format', () => {
    expect(monthBounds('2026-13')).toBeNull()    // month > 12
    expect(monthBounds('2026-00')).toBeNull()    // month 0
    expect(monthBounds('2026-6')).toBeNull()     // missing leading zero
    expect(monthBounds('not-a-date')).toBeNull()
    expect(monthBounds('')).toBeNull()
  })

  it('returns the UTC bounds for a valid month', () => {
    const b = monthBounds('2026-06')!
    expect(b.periodStart.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(b.periodEnd.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('handles the year boundary (December rolls into next January)', () => {
    const b = monthBounds('2026-12')!
    expect(b.periodStart.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(b.periodEnd.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('periodStart < periodEnd always', () => {
    for (const m of ['2026-01', '2026-02', '2026-12', '2030-07']) {
      const b = monthBounds(m)!
      expect(b.periodStart.getTime()).toBeLessThan(b.periodEnd.getTime())
    }
  })
})
