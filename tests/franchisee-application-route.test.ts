import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── /api/franchisee/applications — restaurateur joins a brand (B7, Agent 48) ─────────
// Owner-scoped: the applicant operator comes from the SESSION (session.user.id, never a
// client value → no IDOR). POST guards: owns the restaurant, brand is open, restaurant not
// already linked (1:1), no double live candidacy. Prisma + next-auth mocked.

const { db, getSession } = vi.hoisted(() => ({
  db: {
    restaurant:            { findUnique: vi.fn(), findMany: vi.fn() },
    brand:                 { findUnique: vi.fn(), findMany: vi.fn() },
    franchiseeApplication: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, POST } from '@/app/api/franchisee/applications/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.FRANCHISE_ENABLED = 'true' })
afterEach(() => { delete process.env.FRANCHISE_ENABLED })

const post = (body: unknown) =>
  POST(new Request('http://x/api/franchisee/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: 'op1' } })
  db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', pointOfSaleId: null })
  db.brand.findUnique.mockResolvedValue({ openToFranchise: true, franchiseStatus: 'open' })
  db.franchiseeApplication.findUnique.mockResolvedValue(null)
  db.franchiseeApplication.create.mockResolvedValue({ id: 'a1', status: 'pending' })
  db.franchiseeApplication.findMany.mockResolvedValue([])
  db.restaurant.findMany.mockResolvedValue([])
  db.brand.findMany.mockResolvedValue([])
})

describe('POST /api/franchisee/applications', () => {
  it('(a) owner + open brand → 201, pending candidacy scoped to the session operator', async () => {
    const res = await post({ restaurantId: 'r1', brandId: 'b1' })
    expect(res.status).toBe(201)
    expect(db.franchiseeApplication.create.mock.calls[0][0].data).toMatchObject({
      restaurantId: 'r1', brandId: 'b1', applicantOperatorId: 'op1',
    })
  })

  it('restaurant not owned by the caller → 403, no create (no IDOR)', async () => {
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'someone-else', pointOfSaleId: null })
    expect((await post({ restaurantId: 'r1', brandId: 'b1' })).status).toBe(403)
    expect(db.franchiseeApplication.create).not.toHaveBeenCalled()
  })

  it('brand not open to franchising → 400, no create', async () => {
    db.brand.findUnique.mockResolvedValue({ openToFranchise: false, franchiseStatus: 'none' })
    expect((await post({ restaurantId: 'r1', brandId: 'b1' })).status).toBe(400)
    expect(db.franchiseeApplication.create).not.toHaveBeenCalled()
  })

  it('brand full → 400', async () => {
    db.brand.findUnique.mockResolvedValue({ openToFranchise: true, franchiseStatus: 'full' })
    expect((await post({ restaurantId: 'r1', brandId: 'b1' })).status).toBe(400)
  })

  it('restaurant already linked to a POS → 409 (1:1)', async () => {
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', pointOfSaleId: 'pos1' })
    expect((await post({ restaurantId: 'r1', brandId: 'b1' })).status).toBe(409)
    expect(db.franchiseeApplication.create).not.toHaveBeenCalled()
  })

  it('double pending (same resto+brand) → 409, no create', async () => {
    db.franchiseeApplication.findUnique.mockResolvedValue({ id: 'a0', status: 'pending' })
    expect((await post({ restaurantId: 'r1', brandId: 'b1' })).status).toBe(409)
    expect(db.franchiseeApplication.create).not.toHaveBeenCalled()
  })

  it('re-apply after a rejection → reuses the same row (update to pending), 201', async () => {
    db.franchiseeApplication.findUnique.mockResolvedValue({ id: 'a0', status: 'rejected' })
    db.franchiseeApplication.update.mockResolvedValue({ id: 'a0', status: 'pending' })
    const res = await post({ restaurantId: 'r1', brandId: 'b1' })
    expect(res.status).toBe(201)
    expect(db.franchiseeApplication.update.mock.calls[0][0].data).toMatchObject({ status: 'pending', applicantOperatorId: 'op1' })
    expect(db.franchiseeApplication.create).not.toHaveBeenCalled()
  })

  it('unauthenticated → 401, no read/write', async () => {
    getSession.mockResolvedValue(null)
    expect((await post({ restaurantId: 'r1', brandId: 'b1' })).status).toBe(401)
    expect(db.restaurant.findUnique).not.toHaveBeenCalled()
    expect(db.franchiseeApplication.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/franchisee/applications', () => {
  it('owner-scoped: my candidacies + my eligible (unlinked) restaurants', async () => {
    db.franchiseeApplication.findMany.mockResolvedValue([
      { id: 'a1', restaurantId: 'r1', brandId: 'b1', status: 'pending', message: null, createdAt: new Date(0), decidedAt: null },
    ])
    db.restaurant.findMany.mockResolvedValue([{ id: 'r2', name: 'Resto 2', city: 'Lyon' }])
    db.brand.findMany.mockResolvedValue([{ id: 'b1', name: 'Marco', emoji: '🍕' }])
    const res = await GET()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.authenticated).toBe(true)
    expect(j.applications).toHaveLength(1)
    expect(j.applications[0].brandName).toBe('Marco')
    // scope assertions
    expect(db.franchiseeApplication.findMany.mock.calls[0][0].where).toEqual({ applicantOperatorId: 'op1' })
    expect(db.restaurant.findMany.mock.calls[0][0].where).toEqual({ operatorId: 'op1', archivedAt: null, pointOfSaleId: null })
  })

  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})
