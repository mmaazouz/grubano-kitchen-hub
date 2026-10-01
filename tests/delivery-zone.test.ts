import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── WP-DZONE-01 — delivery-zone enforcement (flag-gated, fail-open) ────────────
// checkDeliveryZone rejects ONLY when the address geocodes cleanly AND is provably
// beyond deliveryRadius; every uncertainty (resto ungeocoded, no radius, BAN
// down/not-found) allows the order. haversineKm is kept REAL so the distance
// assertions bite; only geocodeAddressDetailed is mocked.

const geo = vi.hoisted(() => ({ geocodeAddressDetailed: vi.fn() }))
vi.mock('@/lib/geocode', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/geocode')>()
  return { ...actual, geocodeAddressDetailed: geo.geocodeAddressDetailed }
})

import { isDeliveryZoneEnforcementEnabled, checkDeliveryZone } from '@/lib/delivery-zone'

// Paris center anchor, 5 km radius.
const RESTO = { lat: 48.8566, lng: 2.3522, city: 'Paris', deliveryRadius: 5 }
const NEAR = { latitude: 48.8666, longitude: 2.3522 } // ~1.1 km N → in zone
const FAR  = { latitude: 48.9500, longitude: 2.3522 } // ~10.4 km N → out of zone
const ok   = (coords: { latitude: number; longitude: number }) => ({ status: 'ok' as const, coords })

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { delete process.env.DELIVERY_ZONE_ENFORCEMENT })

describe('isDeliveryZoneEnforcementEnabled — only exact "true"', () => {
  it('OFF by default; "1"/"TRUE" do not enable', () => {
    expect(isDeliveryZoneEnforcementEnabled()).toBe(false)
    process.env.DELIVERY_ZONE_ENFORCEMENT = '1';    expect(isDeliveryZoneEnforcementEnabled()).toBe(false)
    process.env.DELIVERY_ZONE_ENFORCEMENT = 'TRUE'; expect(isDeliveryZoneEnforcementEnabled()).toBe(false)
    process.env.DELIVERY_ZONE_ENFORCEMENT = 'true'; expect(isDeliveryZoneEnforcementEnabled()).toBe(true)
  })
})

describe('checkDeliveryZone — confident reject only', () => {
  it('in zone → ok, geocoded with (address, resto.city)', async () => {
    geo.geocodeAddressDetailed.mockResolvedValue(ok(NEAR))
    const res = await checkDeliveryZone(RESTO, '10 rue de Rivoli')
    expect(res.ok).toBe(true)
    expect((res as any).reason).toBe('in_zone')
    expect(geo.geocodeAddressDetailed).toHaveBeenCalledWith('10 rue de Rivoli', 'Paris')
  })

  it('out of zone → REJECT with distanceKm > radiusKm', async () => {
    geo.geocodeAddressDetailed.mockResolvedValue(ok(FAR))
    const res = await checkDeliveryZone(RESTO, 'far away')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('out_of_zone')
      expect(res.radiusKm).toBe(5)
      expect(res.distanceKm).toBeGreaterThan(5)
    }
  })

  it('resto not geocoded (lat null) → allow, NO geocode call', async () => {
    const res = await checkDeliveryZone({ ...RESTO, lat: null }, 'x')
    expect(res.ok).toBe(true)
    expect(geo.geocodeAddressDetailed).not.toHaveBeenCalled()
  })

  it('resto not geocoded (lng null) → allow, NO geocode call', async () => {
    const res = await checkDeliveryZone({ ...RESTO, lng: null }, 'x')
    expect(res.ok).toBe(true)
    expect(geo.geocodeAddressDetailed).not.toHaveBeenCalled()
  })

  it('no radius configured (0) → allow, NO geocode call', async () => {
    const res = await checkDeliveryZone({ ...RESTO, deliveryRadius: 0 }, 'x')
    expect(res.ok).toBe(true)
    expect(geo.geocodeAddressDetailed).not.toHaveBeenCalled()
  })

  it('BAN unavailable (outage) → allow (fail-open)', async () => {
    geo.geocodeAddressDetailed.mockResolvedValue({ status: 'unavailable' })
    const res = await checkDeliveryZone(RESTO, 'x')
    expect(res.ok).toBe(true)
  })

  it('BAN not_found (typo/unindexed) → allow (fail-open)', async () => {
    geo.geocodeAddressDetailed.mockResolvedValue({ status: 'not_found' })
    const res = await checkDeliveryZone(RESTO, 'x')
    expect(res.ok).toBe(true)
  })
})
