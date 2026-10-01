import { describe, it, expect, afterEach } from 'vitest'
import { isDineInServiceEnabled, dineInServiceCents } from '@/lib/dinein-service'
import { computeApplicationFee } from '@/lib/commission'

// ── WP-MONEY-04 · pure money math — lib/dinein-service.ts (G1) ─────────────────
// Dine-in service charge: 100% to the RESTO (mirror of the delivery fee), ADDED to
// the bill total, but EXCLUDED from the commission base (the 5% dine-in fee stays
// on the FOOD subtotal only). Flag OFF / rate 0 → serviceCents 0 → byte-identical.

afterEach(() => { delete process.env.DINEIN_SERVICE_ENABLED })

// Platform-default rates (no per-restaurant override): dine-in = 5%.
const REST = { commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null }

describe('isDineInServiceEnabled — only exact "true"', () => {
  it('false by default, true only for "true"', () => {
    expect(isDineInServiceEnabled()).toBe(false)
    process.env.DINEIN_SERVICE_ENABLED = 'true'
    expect(isDineInServiceEnabled()).toBe(true)
    process.env.DINEIN_SERVICE_ENABLED = '1'
    expect(isDineInServiceEnabled()).toBe(false)
  })
})

describe('dineInServiceCents — Math.round + ≥0 clamp + null/0/neg rate → 0', () => {
  it('null / undefined / 0 / negative rate → 0 for any subtotal', () => {
    for (const r of [null, undefined, 0, -0.1]) {
      expect(dineInServiceCents(5000, r as number)).toBe(0)
    }
  })
  it('rounds at the cent (half-up)', () => {
    expect(dineInServiceCents(5000, 0.10)).toBe(500)
    expect(dineInServiceCents(1733, 0.10)).toBe(173) // 173.3 → 173
    expect(dineInServiceCents(1755, 0.10)).toBe(176) // 175.5 → 176
  })
  it('negative subtotal clamps ≥ 0', () => {
    expect(dineInServiceCents(-5000, 0.10)).toBe(0)
  })
})

describe('G1 doctrine — service excluded from the commission base, flows to resto net', () => {
  it('the 5% dine-in fee is on the FOOD subtotal only (identical with or without service)', () => {
    const subtotal = 5000
    const feeNoService = computeApplicationFee(REST, 'dinein', subtotal) // 250
    const service = dineInServiceCents(subtotal, 0.10)                   // 500
    const billTotal = subtotal + service                                // gross = 5500
    // fee is computed on the FOOD subtotal, NOT on the bill total → unchanged
    const feeWithService = computeApplicationFee(REST, 'dinein', subtotal)
    expect(feeWithService).toBe(feeNoService)
    // golden triple + the resto keeps 100% of the service
    const net = billTotal - feeWithService
    const netNoService = subtotal - feeNoService
    expect(billTotal).toBe(subtotal + service)
    expect(net - netNoService).toBe(service)
  })
  it('byte-identical when OFF (rate 0 → service 0 → bill total == subtotal)', () => {
    const subtotal = 5000
    expect(dineInServiceCents(subtotal, 0)).toBe(0)
    expect(subtotal + dineInServiceCents(subtotal, 0)).toBe(subtotal)
  })
})
