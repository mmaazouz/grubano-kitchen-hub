import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Géoloc ÉTAPE 3 — GET/PATCH /api/logistics/tracking-consent (courier opt-in) ─────────────
// Owner-scoped (session email → LogisticsProfile), gated by LOGISTICS_TRACKING_ENABLED,
// rate-limited on the write, REVOCABLE. OFF → GET {enabled:false} without reading the column;
// PATCH 404 without writing (deploy-before-migration safe).

const { auth, db, flag, rl } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db:   { logisticsProfile: { findUnique: vi.fn(), update: vi.fn() }, courierPosition: { deleteMany: vi.fn() } },
  flag: { isLogisticsTrackingEnabled: vi.fn() },
  rl:   { rateLimit: vi.fn((): Response | null => null) },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-tracking', () => ({ isLogisticsTrackingEnabled: flag.isLogisticsTrackingEnabled }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rl.rateLimit }))

import { GET, PATCH } from '@/app/api/logistics/tracking-consent/route'

const patch = (body: unknown) => PATCH(new NextRequest('http://x/api/logistics/tracking-consent', {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}))

beforeEach(() => {
  vi.clearAllMocks()
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1', trackingConsent: false })
  db.logisticsProfile.update.mockResolvedValue({ trackingConsent: true })
  db.courierPosition.deleteMany.mockResolvedValue({ count: 1 })
  flag.isLogisticsTrackingEnabled.mockReturnValue(true)
  rl.rateLimit.mockReturnValue(null)
})

describe('PATCH revoke → purges the current position (RGPD Étape 5)', () => {
  it('consent:false ALSO erases the courier own CourierPosition (owner-scoped)', async () => {
    db.logisticsProfile.update.mockResolvedValue({ trackingConsent: false })
    await patch({ consent: false })
    expect(db.courierPosition.deleteMany).toHaveBeenCalledWith({ where: { courierId: 'lp1' } })
  })
  it('consent:true does NOT purge (a live opt-in keeps capturing)', async () => {
    await patch({ consent: true })
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('401 without a session', async () => {
    auth.getServerSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('OFF → { enabled:false }, NEVER reads trackingConsent (safe pre-migration)', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    const json = await (await GET()).json()
    expect(json).toEqual({ enabled: false })
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled()
  })
  it('ON → { enabled:true, consent }, owner-scoped by session email', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue({ trackingConsent: true })
    const json = await (await GET()).json()
    expect(json).toEqual({ enabled: true, consent: true })
    expect(db.logisticsProfile.findUnique.mock.calls[0][0].where).toEqual({ email: 'c@x.fr' })
  })
  it('ON + no profile → 403', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
  })
})

describe('PATCH', () => {
  it('OFF → 404 gated, NO write (never touches the column)', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    const res = await patch({ consent: true })
    expect(res.status).toBe(404)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })
  it('ON grant → sets trackingConsent + trackingConsentAt, owner-scoped by session email', async () => {
    const res = await patch({ consent: true })
    expect(res.status).toBe(200)
    const call = db.logisticsProfile.update.mock.calls[0][0]
    expect(call.where).toEqual({ email: 'c@x.fr' }) // never a client id → no IDOR
    expect(call.data.trackingConsent).toBe(true)
    expect(call.data.trackingConsentAt).toBeInstanceOf(Date) // accountability stamp
  })
  it('REVOKE (consent:false) → clears the opt-in, still stamps the decision time', async () => {
    db.logisticsProfile.update.mockResolvedValue({ trackingConsent: false })
    const res = await patch({ consent: false })
    expect(res.status).toBe(200)
    const call = db.logisticsProfile.update.mock.calls[0][0]
    expect(call.data.trackingConsent).toBe(false)
    expect(call.data.trackingConsentAt).toBeInstanceOf(Date)
  })
  it('no session → 401, no profile → 403, invalid body → 400 (no write on any)', async () => {
    auth.getServerSession.mockResolvedValue(null)
    expect((await patch({ consent: true })).status).toBe(401)
    auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect((await patch({ consent: true })).status).toBe(403)
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1' })
    expect((await patch({ consent: 'yes' })).status).toBe(400)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })
  it('rate-limited → returns the limiter response, no write', async () => {
    rl.rateLimit.mockReturnValue(new Response('slow', { status: 429 }))
    expect((await patch({ consent: true })).status).toBe(429)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })
})
