import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Géoloc ÉTAPE 4 — pure display helpers: coarsenLatLng (never exact) + etaMinutes. ───────────
// haversineKm is mocked so the ETA math is asserted in isolation; coarsenLatLng is pure.

const { geo } = vi.hoisted(() => ({ geo: { haversineKm: vi.fn() } }))
vi.mock('@/lib/geocode', () => ({ haversineKm: geo.haversineKm }))

import { coarsenLatLng, roundTo, etaMinutes, CLIENT_POSITION_DECIMALS } from '@/lib/courier-position-view'

beforeEach(() => { vi.clearAllMocks() })

describe('coarsenLatLng — GROSSIR, never the exact point', () => {
  it('rounds to a coarse grid (default 3 decimals ≈ 111 m) — the exact coordinates never leak', () => {
    const exactLat = 48.85678912, exactLng = 2.35234567
    const c = coarsenLatLng(exactLat, exactLng)
    expect(CLIENT_POSITION_DECIMALS).toBe(3)
    expect(c).toEqual({ lat: 48.857, lng: 2.352 })
    // The coarse value is NOT the exact input (privacy invariant).
    expect(c.lat).not.toBe(exactLat)
    expect(c.lng).not.toBe(exactLng)
  })
  it('is deterministic — repeated coarsening of the same point returns the same cell (averaging-safe)', () => {
    const a = coarsenLatLng(48.85678912, 2.35234567)
    const b = coarsenLatLng(48.85678912, 2.35234567)
    expect(a).toEqual(b)
  })
  it('honours an explicit (coarser) precision', () => {
    expect(coarsenLatLng(48.85678, 2.35234, 2)).toEqual({ lat: 48.86, lng: 2.35 })
    expect(coarsenLatLng(48.85678, 2.35234, 1)).toEqual({ lat: 48.9, lng: 2.4 })
  })
  it('roundTo — half-up rounding to N places', () => {
    expect(roundTo(1.23456, 3)).toBe(1.235)
    expect(roundTo(-1.23456, 2)).toBe(-1.23)
    expect(roundTo(10, 3)).toBe(10)
  })
})

describe('etaMinutes — approximate, ≥1, from the EXACT point (only minutes exposed)', () => {
  const A = { lat: 48.85, lng: 2.35 }, B = { lat: 48.86, lng: 2.36 }
  it('km / speed × 60, ceiled (3 km at 18 km/h → 10 min)', () => {
    geo.haversineKm.mockReturnValue(3)
    expect(etaMinutes(A, B, 18)).toBe(10)
  })
  it('always at least 1 minute (a courier at the door)', () => {
    geo.haversineKm.mockReturnValue(0.01)
    expect(etaMinutes(A, B, 18)).toBe(1)
  })
  it('ceils partial minutes', () => {
    geo.haversineKm.mockReturnValue(2) // 2/18*60 = 6.66… → 7
    expect(etaMinutes(A, B, 18)).toBe(7)
  })
  it('respects a custom speed', () => {
    geo.haversineKm.mockReturnValue(10)
    expect(etaMinutes(A, B, 30)).toBe(20) // 10/30*60
  })
  it('passes lat/lng to haversine as latitude/longitude', () => {
    geo.haversineKm.mockReturnValue(1)
    etaMinutes(A, B, 18)
    expect(geo.haversineKm).toHaveBeenCalledWith(
      { latitude: 48.85, longitude: 2.35 },
      { latitude: 48.86, longitude: 2.36 },
    )
  })
})
