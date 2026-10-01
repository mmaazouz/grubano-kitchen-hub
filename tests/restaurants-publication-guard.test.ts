import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── SEC1 — admin-only publication guard (Agent 26) ───────────────────────────
// A restaurant is visible on /eat ONLY when Restaurant.isActive is true
// (/api/restaurants filters where:{isActive:true}). So isActive IS the
// publication barrier and bringing an establishment ONLINE must be an admin
// decision. These tests lock the three write surfaces:
//   • PATCH /api/restaurants/[id]      — owner-supplied isActive is stripped;
//                                         only an admin can write it.
//   • PATCH /api/restaurants/[id]/pause — owner may set false (pause) but not
//                                         true (publish/re-publish) → admin only.
//   • POST  /api/restaurants            — a created restaurant is forced false.
// Ownership (no IDOR) and the owner's ability to edit other fields are kept.

const { db } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    brand:      { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

// Geocode is a soft step in the create/patch flows — stub it so no network is hit
// and an address is always considered plausible (we test authorization, not geo).
vi.mock('@/lib/geocode', () => ({
  geocodeAddressDetailed: vi.fn().mockResolvedValue({ status: 'ok', coords: { latitude: 1, longitude: 2 } }),
  isPlausibleAddress: () => true,
}))

import { PATCH } from '@/app/api/restaurants/[id]/route'
import { PATCH as PAUSE } from '@/app/api/restaurants/[id]/pause/route'
import { POST } from '@/app/api/restaurants/route'

const sess = (email: string) => sessionMock.mockResolvedValue({ user: { email } })

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('https://app.grubano.com/api/restaurants/r1', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), { params: { id: 'r1' } })

const pause = async (body: Record<string, unknown>) => {
  // The route handler always returns a NextResponse; the early `return auth.error`
  // widens its inferred type to include `undefined`, so narrow it away here.
  const res = await PAUSE(new Request('https://app.grubano.com/api/restaurants/r1/pause', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), { params: { id: 'r1' } })
  return res!
}

const create = (body: Record<string, unknown>) =>
  POST(new Request('https://app.grubano.com/api/restaurants', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

beforeEach(() => {
  vi.clearAllMocks()
  db.restaurant.update.mockResolvedValue({ id: 'r1' })
  db.restaurant.create.mockResolvedValue({ id: 'r1' })
  db.brand.updateMany.mockResolvedValue({ count: 0 })
  // Interactive transaction (brand-attach) → replay the callback on the same mock client.
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db))
})

describe('SEC1 — PATCH /api/restaurants/[id] (publication is admin-only)', () => {
  it('(a) owner cannot set isActive:true — it is stripped, the DB value is untouched', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', address: 'A', city: 'C' })
    const res = await patch({ isActive: true })
    expect(res.status).toBe(200)
    expect(db.restaurant.update).toHaveBeenCalledTimes(1)
    expect(db.restaurant.update.mock.calls[0][0].data).not.toHaveProperty('isActive')
  })

  it('(b) owner can still edit other fields (name applied, isActive still stripped)', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', address: 'A', city: 'C' })
    await patch({ name: 'Nouveau nom', isActive: true })
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.name).toBe('Nouveau nom')
    expect(data).not.toHaveProperty('isActive')
  })

  it('(c) admin CAN publish (isActive:true is applied)', async () => {
    sess('admin@x')
    db.operator.findUnique.mockResolvedValue({ id: 'admin1', role: 'admin' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', address: 'A', city: 'C' })
    await patch({ isActive: true })
    expect(db.restaurant.update.mock.calls[0][0].data.isActive).toBe(true)
  })

  it('admin can also unpublish (isActive:false is applied)', async () => {
    sess('admin@x')
    db.operator.findUnique.mockResolvedValue({ id: 'admin1', role: 'admin' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', address: 'A', city: 'C' })
    await patch({ isActive: false })
    expect(db.restaurant.update.mock.calls[0][0].data.isActive).toBe(false)
  })

  it('(e) a non-owner non-admin editing another restaurant → 403, no write (no IDOR)', async () => {
    sess('intruder@x')
    db.operator.findUnique.mockResolvedValue({ id: 'intruder', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', address: 'A', city: 'C' })
    const res = await patch({ name: 'hijack' })
    expect(res.status).toBe(403)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })
})

describe('SEC1 — pause route (owner may pause, only admin may publish)', () => {
  it('(d) owner can pause / unpublish their own restaurant (isActive:false applied)', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1' })
    const res = await pause({ isActive: false })
    expect(res.status).toBe(200)
    expect(db.restaurant.update.mock.calls[0][0].data.isActive).toBe(false)
  })

  it('owner CANNOT bring it online via pause (isActive:true → 403, no write)', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1' })
    const res = await pause({ isActive: true })
    expect(res.status).toBe(403)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('admin CAN bring it online via pause (isActive:true applied)', async () => {
    sess('admin@x')
    db.operator.findUnique.mockResolvedValue({ id: 'admin1', role: 'admin' })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1' })
    const res = await pause({ isActive: true })
    expect(res.status).toBe(200)
    expect(db.restaurant.update.mock.calls[0][0].data.isActive).toBe(true)
  })
})

describe('SEC1 — POST /api/restaurants (a created restaurant is never published)', () => {
  it('(f) create forces isActive:false even when the client sends true', async () => {
    sess('owner@x')
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.restaurant.findFirst.mockResolvedValue(null) // no existing restaurant → not a duplicate
    const res = await create({ name: 'Resto', city: 'Orange', address: '12 rue de la Paix', isActive: true })
    expect(res.status).toBe(201)
    expect(db.restaurant.create.mock.calls[0][0].data.isActive).toBe(false)
  })
})
