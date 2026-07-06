import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P4.3 ÉTAPE 5 — POST /api/logistics/fee-preview (cart display) ─────────────────────
// Flag OFF (default) → { enabled:false }, NO geocode, NO restaurant query → the cart keeps
// the flat fee (byte-identical). ON → distance fee via the SAME barème; FAIL-OPEN to flat.

const { db, feeLib, rl } = vi.hoisted(() => ({
  db:     { restaurant: { findFirst: vi.fn() } },
  feeLib: { isLogisticsDistanceFeeEnabled: vi.fn(), resolveDistanceDeliveryFee: vi.fn() },
  rl:     { rateLimit: vi.fn((): Response | null => null) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-fee', () => ({
  isLogisticsDistanceFeeEnabled: feeLib.isLogisticsDistanceFeeEnabled,
  resolveDistanceDeliveryFee:    feeLib.resolveDistanceDeliveryFee,
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rl.rateLimit }))

import { POST } from '@/app/api/logistics/fee-preview/route'

const req = (body: unknown) => new NextRequest('http://x/api/logistics/fee-preview', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})

beforeEach(() => {
  vi.clearAllMocks()
  rl.rateLimit.mockReturnValue(null)
  feeLib.isLogisticsDistanceFeeEnabled.mockReturnValue(true)
  db.restaurant.findFirst.mockResolvedValue({ lat: 48.86, lng: 2.35, city: 'Paris', deliveryFee: 4.5 })
  feeLib.resolveDistanceDeliveryFee.mockResolvedValue({ feeCents: 300, distanceKm: 3, coords: { latitude: 48.88, longitude: 2.34 } })
})

it('flag OFF → { enabled:false }, NO geocode, NO restaurant query (byte-identical cart)', async () => {
  feeLib.isLogisticsDistanceFeeEnabled.mockReturnValue(false)
  const json = await (await POST(req({ restaurantId: 'r1', address: '12 rue X' }))).json()
  expect(json).toEqual({ enabled: false })
  expect(db.restaurant.findFirst).not.toHaveBeenCalled()
  expect(feeLib.resolveDistanceDeliveryFee).not.toHaveBeenCalled()
})

it('flag ON + geocode ok → { enabled:true, mode:distance, feeCents }', async () => {
  const json = await (await POST(req({ restaurantId: 'r1', address: '12 rue X' }))).json()
  expect(json).toEqual({ enabled: true, mode: 'distance', feeCents: 300 })
})

it('flag ON + geocode fails → FALL BACK to the flat fee (mode:flat)', async () => {
  feeLib.resolveDistanceDeliveryFee.mockResolvedValue(null)
  const json = await (await POST(req({ restaurantId: 'r1', address: '12 rue X' }))).json()
  expect(json).toEqual({ enabled: true, mode: 'flat', feeCents: 450 }) // round(4.5*100)
})

it('unknown restaurant → 404', async () => {
  db.restaurant.findFirst.mockResolvedValue(null)
  expect((await POST(req({ restaurantId: 'nope', address: '12 rue X' }))).status).toBe(404)
})

it('invalid body → 400', async () => {
  expect((await POST(req({ restaurantId: '' }))).status).toBe(400)
})

it('rate-limited → returns the limiter response', async () => {
  const limited = new Response('slow down', { status: 429 })
  rl.rateLimit.mockReturnValue(limited)
  expect((await POST(req({ restaurantId: 'r1', address: '12 rue X' }))).status).toBe(429)
})
