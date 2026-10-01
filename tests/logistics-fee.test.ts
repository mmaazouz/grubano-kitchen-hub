import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.3 ÉTAPE 4 — distance-based delivery fee (lib/logistics-fee) ───────────────────
// Locks the PURE barème (base + per-km, clamp min/max, NaN/negative bounds, validated
// config) + the fail-open geocode resolver. Integer cents throughout. Geocode mocked.

const { geo } = vi.hoisted(() => ({ geo: { geocodeAddressDetailed: vi.fn(), haversineKm: vi.fn() } }))
vi.mock('@/lib/geocode', () => ({
  geocodeAddressDetailed: geo.geocodeAddressDetailed,
  haversineKm:            geo.haversineKm,
  geocodeAddress:         vi.fn(),
  isPlausibleAddress:     vi.fn(),
  wait:                   vi.fn(),
}))

import {
  isLogisticsDistanceFeeEnabled, computeDistanceFeeCents,
  logisticsFeeBaseCents, logisticsFeePerKmCents, logisticsFeeMinCents, logisticsFeeMaxCents,
  resolveDistanceDeliveryFee,
} from '@/lib/logistics-fee'

const ENVS = [
  'LOGISTICS_DISTANCE_FEE_ENABLED', 'LOGISTICS_FEE_BASE_CENTS',
  'LOGISTICS_FEE_PER_KM_CENTS', 'LOGISTICS_FEE_MIN_CENTS', 'LOGISTICS_FEE_MAX_CENTS',
]
beforeEach(() => { vi.clearAllMocks(); ENVS.forEach(e => delete process.env[e]) })
afterEach(() => { ENVS.forEach(e => delete process.env[e]) })

describe('flag — LOGISTICS_DISTANCE_FEE_ENABLED', () => {
  it('OFF by default; only the exact "true" enables', () => {
    expect(isLogisticsDistanceFeeEnabled()).toBe(false)
    process.env.LOGISTICS_DISTANCE_FEE_ENABLED = 'true'; expect(isLogisticsDistanceFeeEnabled()).toBe(true)
    process.env.LOGISTICS_DISTANCE_FEE_ENABLED = '1';    expect(isLogisticsDistanceFeeEnabled()).toBe(false)
  })
})

describe('config readers — validated integer cents', () => {
  it('defaults (150 / 50 / 199 / 900)', () => {
    expect(logisticsFeeBaseCents()).toBe(150)
    expect(logisticsFeePerKmCents()).toBe(50)
    expect(logisticsFeeMinCents()).toBe(199)
    expect(logisticsFeeMaxCents()).toBe(900)
  })
  it('valid env override', () => {
    process.env.LOGISTICS_FEE_BASE_CENTS = '100';  expect(logisticsFeeBaseCents()).toBe(100)
    process.env.LOGISTICS_FEE_PER_KM_CENTS = '75';  expect(logisticsFeePerKmCents()).toBe(75)
    process.env.LOGISTICS_FEE_MAX_CENTS = '1200';   expect(logisticsFeeMaxCents()).toBe(1200)
  })
  it('reject negative / NaN / empty → fallback to default; 0 is valid', () => {
    process.env.LOGISTICS_FEE_BASE_CENTS = '-5';   expect(logisticsFeeBaseCents()).toBe(150)
    process.env.LOGISTICS_FEE_PER_KM_CENTS = 'abc'; expect(logisticsFeePerKmCents()).toBe(50)
    process.env.LOGISTICS_FEE_MIN_CENTS = '';       expect(logisticsFeeMinCents()).toBe(199)
    process.env.LOGISTICS_FEE_BASE_CENTS = '0';    expect(logisticsFeeBaseCents()).toBe(0)
  })
})

describe('computeDistanceFeeCents — PURE clamp(round(base + perKm × km), min, max)', () => {
  it('base + per-km within band (defaults 150 + 50/km)', () => {
    expect(computeDistanceFeeCents(1)).toBe(200) // 150 + 50
    expect(computeDistanceFeeCents(3)).toBe(300) // 150 + 150
    expect(computeDistanceFeeCents(5)).toBe(400) // 150 + 250
  })
  it('floors at MIN (199)', () => {
    expect(computeDistanceFeeCents(0)).toBe(199)   // 150 → 199
    expect(computeDistanceFeeCents(0.5)).toBe(199) // 175 → 199
  })
  it('caps at MAX (900)', () => {
    expect(computeDistanceFeeCents(20)).toBe(900)  // 1150 → 900
    expect(computeDistanceFeeCents(100)).toBe(900)
  })
  it('rounds to integer cents', () => {
    process.env.LOGISTICS_FEE_PER_KM_CENTS = '33'
    expect(computeDistanceFeeCents(3.7)).toBe(272) // 150 + 122.1 → round 272
    expect(Number.isInteger(computeDistanceFeeCents(3.7))).toBe(true)
  })
  it('NaN / negative / non-finite distance → treated as 0 (floors at min)', () => {
    expect(computeDistanceFeeCents(NaN)).toBe(199)
    expect(computeDistanceFeeCents(-5)).toBe(199)
    expect(computeDistanceFeeCents(Infinity)).toBe(199)
  })
  it('inverted config (min > max) → returns max (safe bounded, never unbounded/negative)', () => {
    process.env.LOGISTICS_FEE_MIN_CENTS = '900'
    process.env.LOGISTICS_FEE_MAX_CENTS = '199'
    expect(computeDistanceFeeCents(3)).toBe(199) // clamp returns max when min>max
  })
})

describe('resolveDistanceDeliveryFee — geocode + haversine, FAIL-OPEN to null', () => {
  const RESTO = { lat: 48.86, lng: 2.35, city: 'Paris' }

  it('geocode ok → { feeCents, distanceKm, coords }, city sharpens the query', async () => {
    geo.geocodeAddressDetailed.mockResolvedValue({ status: 'ok', coords: { latitude: 48.88, longitude: 2.34 } })
    geo.haversineKm.mockReturnValue(3)
    const r = await resolveDistanceDeliveryFee(RESTO, '12 rue X')
    expect(r).toEqual({ feeCents: 300, distanceKm: 3, coords: { latitude: 48.88, longitude: 2.34 } })
    expect(geo.geocodeAddressDetailed).toHaveBeenCalledWith('12 rue X', 'Paris')
    expect(geo.haversineKm).toHaveBeenCalledWith(
      { latitude: 48.86, longitude: 2.35 }, { latitude: 48.88, longitude: 2.34 },
    )
  })
  it('restaurant not geocoded (lat/lng null) → null, NO geocode call', async () => {
    expect(await resolveDistanceDeliveryFee({ lat: null, lng: null, city: 'Paris' }, 'X')).toBeNull()
    expect(geo.geocodeAddressDetailed).not.toHaveBeenCalled()
  })
  it('BAN not_found → null (fallback to flat)', async () => {
    geo.geocodeAddressDetailed.mockResolvedValue({ status: 'not_found' })
    expect(await resolveDistanceDeliveryFee(RESTO, 'X')).toBeNull()
  })
  it('BAN unavailable (outage/rate-limit) → null (fallback to flat)', async () => {
    geo.geocodeAddressDetailed.mockResolvedValue({ status: 'unavailable' })
    expect(await resolveDistanceDeliveryFee(RESTO, 'X')).toBeNull()
  })
  it('geocode throws → null (NEVER throws into the order path)', async () => {
    geo.geocodeAddressDetailed.mockRejectedValue(new Error('boom'))
    expect(await resolveDistanceDeliveryFee(RESTO, 'X')).toBeNull()
  })
})
