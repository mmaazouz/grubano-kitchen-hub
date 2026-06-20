import { describe, it, expect } from 'vitest'
import { computeServiceEconomics, SERVICE_COMMISSION_RATE } from '@/lib/service-pricing'

// ── Service economics engine (PURE, P6, Agent 79) ─────────────────────────────
// The resto pays the agreed quote; Grubano keeps 5 %; the prestataire receives the rest.
// Integer cents. NO money moves — this only computes amounts. The CARDINAL invariant:
//   restaurantPaysCents === prestataireNetCents + grubanoMarginCents   (always exact)
// The net is DERIVED as the difference (resto − margin) so the split can never drift a cent.

describe('SERVICE_COMMISSION_RATE — the decided economics', () => {
  it('is exactly 5 %', () => {
    expect(SERVICE_COMMISSION_RATE).toBe(0.05)
  })
})

describe('computeServiceEconomics — 5 % exact on round amounts', () => {
  it('100 € → Grubano 5 €, prestataire 95 €', () => {
    const e = computeServiceEconomics(10_000)
    expect(e.rate).toBe(0.05)
    expect(e.restaurantPaysCents).toBe(10_000)
    expect(e.grubanoMarginCents).toBe(500)
    expect(e.prestataireNetCents).toBe(9_500)
  })
  it('150 € → Grubano 7,50 €, prestataire 142,50 €', () => {
    const e = computeServiceEconomics(15_000)
    expect(e.grubanoMarginCents).toBe(750)
    expect(e.prestataireNetCents).toBe(14_250)
  })
})

describe('rounding — controlled (round-half-up on the margin), invariant preserved', () => {
  it('333 ¢ → 333 × 0.05 = 16.65 → margin 17, net 316 (sum 333)', () => {
    const e = computeServiceEconomics(333)
    expect(e.grubanoMarginCents).toBe(17)         // Math.round(16.65) = 17
    expect(e.prestataireNetCents).toBe(316)
    expect(e.restaurantPaysCents).toBe(e.prestataireNetCents + e.grubanoMarginCents)
  })
  it('199 ¢ → 9.95 → margin 10, net 189', () => {
    const e = computeServiceEconomics(199)
    expect(e.grubanoMarginCents).toBe(10)
    expect(e.prestataireNetCents).toBe(189)
  })
  it('a fractional input is rounded to whole cents first', () => {
    const e = computeServiceEconomics(10_000.7)
    expect(e.restaurantPaysCents).toBe(10_001)
    expect(e.restaurantPaysCents).toBe(e.prestataireNetCents + e.grubanoMarginCents)
  })
})

describe('bounds — 0, negative, non-finite, very large', () => {
  it('0 → everything 0', () => {
    expect(computeServiceEconomics(0)).toMatchObject({ restaurantPaysCents: 0, grubanoMarginCents: 0, prestataireNetCents: 0 })
  })
  it('a negative amount is clamped to 0 (never a negative invoice)', () => {
    const e = computeServiceEconomics(-5_000)
    expect(e.restaurantPaysCents).toBe(0)
    expect(e.grubanoMarginCents).toBe(0)
    expect(e.prestataireNetCents).toBe(0)
  })
  it('NaN / Infinity collapse to 0 (no invoice can blow up)', () => {
    expect(computeServiceEconomics(Number.NaN).restaurantPaysCents).toBe(0)
    expect(computeServiceEconomics(Number.POSITIVE_INFINITY).restaurantPaysCents).toBe(0)
  })
  it('1 000 000 € → Grubano 50 000 €, prestataire 950 000 €', () => {
    const e = computeServiceEconomics(100_000_000)
    expect(e.grubanoMarginCents).toBe(5_000_000)
    expect(e.prestataireNetCents).toBe(95_000_000)
    expect(e.restaurantPaysCents).toBe(e.prestataireNetCents + e.grubanoMarginCents)
  })
})

describe('rate override is clamped to [0, 1]', () => {
  it('rate 0 → margin 0, net = full amount', () => {
    const e = computeServiceEconomics(10_000, 0)
    expect(e.rate).toBe(0)
    expect(e.grubanoMarginCents).toBe(0)
    expect(e.prestataireNetCents).toBe(10_000)
  })
  it('rate 1 → margin = full amount, net 0', () => {
    const e = computeServiceEconomics(10_000, 1)
    expect(e.grubanoMarginCents).toBe(10_000)
    expect(e.prestataireNetCents).toBe(0)
  })
  it('rate > 1 clamps to 1; rate < 0 clamps to 0; NaN → 0', () => {
    expect(computeServiceEconomics(10_000, 5).rate).toBe(1)
    expect(computeServiceEconomics(10_000, -3).rate).toBe(0)
    expect(computeServiceEconomics(10_000, Number.NaN).rate).toBe(0)
  })
})

describe('INVARIANT (property sweep) — resto == net + margin, for every amount', () => {
  it('conservation holds + bounds, margin = round(amount × 0.05)', () => {
    for (let amount = 0; amount <= 200_000; amount += 137) {
      const e = computeServiceEconomics(amount)
      expect(e.restaurantPaysCents).toBe(e.prestataireNetCents + e.grubanoMarginCents) // no drift
      expect(e.grubanoMarginCents).toBe(Math.round(amount * 0.05))
      expect(e.grubanoMarginCents).toBeGreaterThanOrEqual(0)
      expect(e.prestataireNetCents).toBeGreaterThanOrEqual(0)
      expect(e.prestataireNetCents).toBeLessThanOrEqual(amount)
      expect(e.restaurantPaysCents).toBe(amount)
    }
  })
  it('invariant survives arbitrary rates too', () => {
    for (const rate of [0, 0.01, 0.05, 0.2, 0.5, 1]) {
      for (const amount of [1, 99, 333, 12_345, 999_999]) {
        const e = computeServiceEconomics(amount, rate)
        expect(e.restaurantPaysCents).toBe(e.prestataireNetCents + e.grubanoMarginCents)
        expect(e.grubanoMarginCents).toBeGreaterThanOrEqual(0)
        expect(e.prestataireNetCents).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
