import { describe, it, expect } from 'vitest'
import {
  computeSupplyEconomics, applicableTier, supplyBaseCents,
  DEFAULT_TIERS, DEFAULT_TAKE_RATE, type SupplyPricingConfig,
} from '@/lib/supply-pricing'

// ── B2B supply economics engine (PURE, Slice 5a, Agent 14) ────────────────────
// No money moves; integer cents; conservation invariant; anti-double-charge.

describe('supplyBaseCents', () => {
  it('sums quantity × unit price in cents', () => {
    expect(supplyBaseCents([{ quantity: 3, unitPriceCents: 250 }, { quantity: 2, unitPriceCents: 100 }])).toBe(950)
    expect(supplyBaseCents([])).toBe(0)
  })
})

describe('applicableTier', () => {
  it('null below the first threshold, highest met tier otherwise', () => {
    expect(applicableTier(19_999)).toBeNull()
    expect(applicableTier(20_000)?.discountRate).toBe(0.08)
    expect(applicableTier(49_999)?.discountRate).toBe(0.08)
    expect(applicableTier(50_000)?.discountRate).toBe(0.12)
    expect(applicableTier(100_000)?.discountRate).toBe(0.15)
    expect(applicableTier(10_000_000)?.discountRate).toBe(0.15)
  })
})

describe('FLAT regime (off-tier) — take-rate on the supplier payout only', () => {
  it('resto pays the full supplier price; Grubano takes 1%; supplier bears it', () => {
    const e = computeSupplyEconomics({ baseCents: 10_000, volumeCents: 10_000 })
    expect(e.regime).toBe('flat')
    expect(e.restoPaysCents).toBe(10_000)       // full price, no markup
    expect(e.grubanoMarginCents).toBe(100)      // 1% of 100 €
    expect(e.supplierPayoutCents).toBe(9_900)
    expect(e.restoSavingsCents).toBe(0)
    expect(e.discountRate).toBe(0)
    expect(e.grubanoShareRate).toBe(DEFAULT_TAKE_RATE)
  })
})

describe('TIER regime — negotiated discount split (anti-double-charge)', () => {
  const cases = [
    { base: 25_000, d: 0.08, r: 0.05, supplier: 23_000, resto: 23_750, grubano: 750 },   // −8% / resto −5% / +3%
    { base: 60_000, d: 0.12, r: 0.08, supplier: 52_800, resto: 55_200, grubano: 2_400 }, // −12% / resto −8% / +4%
    { base: 120_000, d: 0.15, r: 0.10, supplier: 102_000, resto: 108_000, grubano: 6_000 }, // −15% / resto −10% / +5%
  ]
  for (const c of cases) {
    it(`base ${c.base}¢ → d ${c.d}: resto ${c.resto}, supplier ${c.supplier}, Grubano ${c.grubano}; NO flat take-rate`, () => {
      const e = computeSupplyEconomics({ baseCents: c.base, volumeCents: c.base })
      expect(e.regime).toBe('tier')
      expect(e.discountRate).toBe(c.d)
      expect(e.restoPaysCents).toBe(c.resto)
      expect(e.supplierPayoutCents).toBe(c.supplier)
      expect(e.grubanoMarginCents).toBe(c.grubano)         // = captured savings share (d − r)
      expect(e.restoSavingsCents).toBe(c.base - c.resto)   // resto's benefit
      expect(e.takeRate).toBe(0)                            // anti-double-charge: flat take-rate NOT applied
      expect(e.restoPaysCents).toBeLessThan(c.base)         // resto pays strictly less than catalogue
    })
  }
})

describe('anti-double-charge boundary (off-tier ↔ tier)', () => {
  it('just below tier 1 → flat (take-rate); exactly at tier 1 → tier (take-rate = 0)', () => {
    const below = computeSupplyEconomics({ baseCents: 19_999, volumeCents: 19_999 })
    expect(below.regime).toBe('flat')
    expect(below.grubanoMarginCents).toBe(Math.round(19_999 * DEFAULT_TAKE_RATE)) // 200
    const at = computeSupplyEconomics({ baseCents: 20_000, volumeCents: 20_000 })
    expect(at.regime).toBe('tier')
    expect(at.takeRate).toBe(0)
    expect(at.grubanoMarginCents).toBe(Math.round(20_000 * 0.03)) // (d−r)=3% → 600, not take-rate
  })

  it('aggregated VOLUME (group buy) can lift a small order into a tier', () => {
    // small order base, but a large aggregated volume → tier applies on the order base
    const e = computeSupplyEconomics({ baseCents: 5_000, volumeCents: 120_000 })
    expect(e.regime).toBe('tier')
    expect(e.discountRate).toBe(0.15)
    expect(e.restoPaysCents).toBe(5_000 - Math.round(5_000 * 0.10))
  })
})

describe('conservation + bounds (property sweep)', () => {
  it('restoPays = supplierPayout + grubanoMargin; margin ≥ 0; resto ≤ base — for every base/volume', () => {
    for (let base = 0; base <= 200_000; base += 137) {
      for (const volume of [base, 0, 19_999, 20_000, 50_000, 100_000, 250_000]) {
        const e = computeSupplyEconomics({ baseCents: base, volumeCents: volume })
        expect(e.restoPaysCents).toBe(e.supplierPayoutCents + e.grubanoMarginCents) // conservation, no drift
        expect(e.grubanoMarginCents).toBeGreaterThanOrEqual(0)
        expect(e.restoPaysCents).toBeLessThanOrEqual(base)
        expect(e.supplierPayoutCents).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('rounding + edge cases', () => {
  it('rounds to integer cents while preserving conservation', () => {
    const e = computeSupplyEconomics({ baseCents: 333, volumeCents: 333 }) // flat, 1% of 333 = 3.33 → 3
    expect(e.grubanoMarginCents).toBe(3)
    expect(e.supplierPayoutCents).toBe(330)
    expect(e.restoPaysCents).toBe(333)
  })
  it('zero base / zero volume / single-unit', () => {
    expect(computeSupplyEconomics({ baseCents: 0 })).toMatchObject({ restoPaysCents: 0, supplierPayoutCents: 0, grubanoMarginCents: 0 })
    const tiny = computeSupplyEconomics({ baseCents: 250, volumeCents: 250 })
    expect(tiny.regime).toBe('flat') // one cheap item → off-tier
    expect(tiny.restoPaysCents).toBe(250)
  })
})

describe('configurable (per-supplier agreement overrides the defaults)', () => {
  it('respects a custom take-rate + custom tiers', () => {
    const cfg: SupplyPricingConfig = {
      takeRate: 0.03, // 3%
      tiers: [{ minVolumeCents: 10_000, discountRate: 0.20, restoShareRate: 0.12 }],
    }
    const flat = computeSupplyEconomics({ baseCents: 5_000, volumeCents: 5_000, config: cfg })
    expect(flat.grubanoMarginCents).toBe(150) // 3% of 50 €
    const tier = computeSupplyEconomics({ baseCents: 10_000, volumeCents: 10_000, config: cfg })
    expect(tier.discountRate).toBe(0.20)
    expect(tier.restoPaysCents).toBe(10_000 - 1_200)  // resto −12%
    expect(tier.supplierPayoutCents).toBe(10_000 - 2_000) // supplier −20%
    expect(tier.grubanoMarginCents).toBe(800)         // (20−12)% of 100 €
  })
  it('clamps a misconfigured resto share above the discount (Grubano margin never negative)', () => {
    const cfg: SupplyPricingConfig = { takeRate: 0.01, tiers: [{ minVolumeCents: 0, discountRate: 0.10, restoShareRate: 0.50 }] }
    const e = computeSupplyEconomics({ baseCents: 10_000, volumeCents: 10_000, config: cfg })
    expect(e.grubanoMarginCents).toBeGreaterThanOrEqual(0)
    expect(e.restoPaysCents).toBeLessThanOrEqual(10_000)
  })
})

it('default constants match the decided economics', () => {
  expect(DEFAULT_TAKE_RATE).toBe(0.01)
  expect(DEFAULT_TIERS.map((t) => t.discountRate)).toEqual([0.08, 0.12, 0.15])
  expect(DEFAULT_TIERS.map((t) => t.restoShareRate)).toEqual([0.05, 0.08, 0.10])
})
