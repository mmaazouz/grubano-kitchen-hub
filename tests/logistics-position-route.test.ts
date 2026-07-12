import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Géoloc ÉTAPE 2 — POST /api/logistics/position (INERT last-point receiver, RGPD-sensible) ──
// A point is stored ONLY when ALL hold, else the request is refused WITHOUT a write:
//   (1) LOGISTICS_TRACKING_ENABLED ON  → OFF returns 404 BEFORE any DB access (table + column dormant)
//   (2) trackingConsent === true       → opt-in required
//   (3) mission.courierId === session courier id → owner-scoped, no IDOR (never a body id)
//   (4) status ∈ {accepted, picked_up} → in-course only
// Last-point UPSERT (a new ping REPLACES the previous point — no breadcrumb). Rate-limited.

const { auth, db, flag, rl } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db: {
    logisticsProfile: { findUnique: vi.fn() },
    mission:          { findUnique: vi.fn() },
    courierPosition:  { upsert: vi.fn() },
  },
  flag: { isLogisticsTrackingEnabled: vi.fn() },
  rl:   { rateLimit: vi.fn((): Response | null => null) },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-tracking', () => ({ isLogisticsTrackingEnabled: flag.isLogisticsTrackingEnabled }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rl.rateLimit }))

import { POST } from '@/app/api/logistics/position/route'

const post = (body: unknown) => POST(new NextRequest('http://x/api/logistics/position', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}))
const GOOD = { missionId: 'm1', lat: 48.85, lng: 2.35, accuracy: 12 }

beforeEach(() => {
  vi.clearAllMocks()
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP', trackingConsent: true })
  db.mission.findUnique.mockResolvedValue({ courierId: 'cP', status: 'accepted' })
  db.courierPosition.upsert.mockResolvedValue({ id: 'pos1' })
  flag.isLogisticsTrackingEnabled.mockReturnValue(true)
  rl.rateLimit.mockReturnValue(null)
})

describe('gating (flag OFF)', () => {
  it('OFF → 404 gated, ZERO DB access (no profile/mission read, no upsert) → safe pre-migration', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    const res = await post(GOOD)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ ok: false, gated: true })
    // Nothing touches the new table / column when OFF (byte-identical, deploy-before-migration safe).
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled()
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
})

describe('auth + validation', () => {
  it('rate-limited → returns the limiter response, no write', async () => {
    rl.rateLimit.mockReturnValue(new Response('slow', { status: 429 }))
    const res = await post(GOOD)
    expect(res.status).toBe(429)
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
  it('401 without a session, no write', async () => {
    auth.getServerSession.mockResolvedValue(null)
    const res = await post(GOOD)
    expect(res.status).toBe(401)
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
  it('400 on invalid body (missing missionId / out-of-range lat), no write', async () => {
    expect((await post({ lat: 1, lng: 2 })).status).toBe(400)
    expect((await post({ missionId: 'm1', lat: 200, lng: 2 })).status).toBe(400)
    expect((await post({ missionId: 'm1', lat: 1, lng: 999 })).status).toBe(400)
    expect((await post({ missionId: '', lat: 1, lng: 2 })).status).toBe(400)
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
  it('403 without a courier profile, no mission read, no write', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    const res = await post(GOOD)
    expect(res.status).toBe(403)
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
})

describe('opt-in (RGPD consent)', () => {
  it('403 consent_required when trackingConsent is false — refuses BEFORE the mission lookup, no write', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP', trackingConsent: false })
    const res = await post(GOOD)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'consent_required' })
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
})

describe('owner-scope + in-course (no IDOR)', () => {
  it('403 forbidden when the mission belongs to ANOTHER courier — no write', async () => {
    db.mission.findUnique.mockResolvedValue({ courierId: 'someone_else', status: 'accepted' })
    const res = await post(GOOD)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden' })
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
  it('403 forbidden when the mission is unknown — no write', async () => {
    db.mission.findUnique.mockResolvedValue(null)
    expect((await post(GOOD)).status).toBe(403)
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
  it('409 not_in_course when the mission is not accepted/picked_up (offered / terminal) — no write', async () => {
    for (const status of ['offered', 'delivered', 'cancelled', 'declined', 'expired']) {
      db.mission.findUnique.mockResolvedValue({ courierId: 'cP', status })
      const res = await post(GOOD)
      expect(res.status, status).toBe(409)
    }
    expect(db.courierPosition.upsert).not.toHaveBeenCalled()
  })
})

describe('happy path — last-point upsert', () => {
  it('200 → UPSERT keyed by (session courierId, missionId), a new ping REPLACES the point', async () => {
    const res = await post(GOOD)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const call = db.courierPosition.upsert.mock.calls[0][0]
    // last-point-only: it is an UPSERT (not create) → the previous point is overwritten, no trail.
    expect(call.where).toEqual({ courierId_missionId: { courierId: 'cP', missionId: 'm1' } })
    expect(call.create).toMatchObject({ courierId: 'cP', missionId: 'm1', lat: 48.85, lng: 2.35, accuracy: 12 })
    expect(call.update).toMatchObject({ lat: 48.85, lng: 2.35, accuracy: 12 })
  })
  it('accepts a picked_up mission too', async () => {
    db.mission.findUnique.mockResolvedValue({ courierId: 'cP', status: 'picked_up' })
    expect((await post(GOOD)).status).toBe(200)
    expect(db.courierPosition.upsert).toHaveBeenCalledOnce()
  })
  it('the courierId written is ALWAYS the session courier — a body-injected courierId is ignored', async () => {
    await post({ ...GOOD, courierId: 'HACKER', id: 'x' })
    const call = db.courierPosition.upsert.mock.calls[0][0]
    expect(call.where.courierId_missionId.courierId).toBe('cP') // never 'HACKER'
    expect(call.create.courierId).toBe('cP')
  })
  it('accuracy is optional → stored as null when omitted', async () => {
    await post({ missionId: 'm1', lat: 48.85, lng: 2.35 })
    expect(db.courierPosition.upsert.mock.calls[0][0].create.accuracy).toBeNull()
  })
})
