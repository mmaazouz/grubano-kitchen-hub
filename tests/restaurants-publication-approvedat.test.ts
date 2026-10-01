import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── B2.4 / SEC2 — approvedAt publication rule at the route level (Agent 33) ──
// Companion to restaurants-publication-guard.test.ts (which locks the SEC1
// invariant with approvedAt=null). Here approvedAt is SET or the resto is LIVE, to
// lock the SEC2 additions on the two owner write surfaces:
//   • pause:  an owner may RESUME an already-approved resto (approvedAt!=null);
//             pausing a live-but-unstamped resto STAMPS approvedAt (pause-capture)
//             so the owner can resume it later; an already-approved resto is not
//             re-stamped.
//   • PATCH:  an owner may resume an already-approved resto via the profile PATCH.
// The never-approved owner-publish REJECTION stays proven in the SEC1 guard file.

const { db } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/geocode', () => ({
  geocodeAddressDetailed: vi.fn().mockResolvedValue({ status: 'ok', coords: { latitude: 1, longitude: 2 } }),
  isPlausibleAddress: () => true,
}))

import { PATCH } from '@/app/api/restaurants/[id]/route'
import { PATCH as PAUSE } from '@/app/api/restaurants/[id]/pause/route'

const sess = (email: string) => sessionMock.mockResolvedValue({ user: { email } })

const pause = async (body: Record<string, unknown>) => {
  const res = await PAUSE(new Request('https://app.grubano.com/api/restaurants/r1/pause', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), { params: { id: 'r1' } })
  return res!
}

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('https://app.grubano.com/api/restaurants/r1', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), { params: { id: 'r1' } })

const APPROVED = new Date('2026-01-01T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  db.restaurant.update.mockResolvedValue({ id: 'r1' })
})

describe('SEC2 — pause route (approvedAt rule)', () => {
  it('owner CAN resume an already-approved resto (approvedAt set, isActive:true) → applied, no re-stamp', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', isActive: false, approvedAt: APPROVED })
    const res = await pause({ isActive: true })
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.isActive).toBe(true)
    expect(data).not.toHaveProperty('approvedAt')
  })

  it('pause-capture: pausing a LIVE unstamped resto → offline + STAMP approvedAt', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', isActive: true, approvedAt: null })
    const res = await pause({ isActive: false })
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.isActive).toBe(false)
    expect(data.approvedAt).toBeInstanceOf(Date)
  })

  it('pausing an already-approved live resto → offline, NO re-stamp', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', isActive: true, approvedAt: APPROVED })
    const res = await pause({ isActive: false })
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.isActive).toBe(false)
    expect(data).not.toHaveProperty('approvedAt')
  })

  it('owner STILL cannot publish a never-approved resto (approvedAt null, isActive:true) → 403, no write', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', isActive: false, approvedAt: null })
    const res = await pause({ isActive: true })
    expect(res.status).toBe(403)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })
})

describe('SEC2 — PATCH /api/restaurants/[id] (approvedAt rule)', () => {
  it('owner CAN resume an already-approved resto via the profile PATCH (isActive:true applied)', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', address: 'A', city: 'C', isActive: false, approvedAt: APPROVED })
    const res = await patch({ isActive: true })
    expect(res.status).toBe(200)
    expect(db.restaurant.update.mock.calls[0][0].data.isActive).toBe(true)
  })

  it('owner publish of a never-approved resto is still stripped (no isActive write)', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', address: 'A', city: 'C', isActive: false, approvedAt: null })
    const res = await patch({ isActive: true })
    expect(res.status).toBe(200)
    expect(db.restaurant.update.mock.calls[0][0].data).not.toHaveProperty('isActive')
  })
})
