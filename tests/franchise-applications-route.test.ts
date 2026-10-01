import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── /api/franchise/applications — franchisor reviews join requests (B7, Agent 48) ────
// Owner-scoped via gateFranchise (operator from SESSION + 'franchise' role). Approve →
// atomic POS create (franchiseId = franchisor) + 1:1 race-safe link of the APPLICANT's
// restaurant (cross-operator, authorized by the double accord). Reject → status only.
// 404 (not 403) when the candidacy targets a brand the operator does not own (no IDOR).
// Prisma + next-auth mocked (same style as franchise-pos-route).

const { db, getSession } = vi.hoisted(() => ({
  db: {
    operator:              { findUnique: vi.fn() },
    operatorRole:          { findMany: vi.fn() },
    brand:                 { findMany: vi.fn(), findUnique: vi.fn() },
    franchiseeApplication: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    restaurant:            { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    pointOfSale:           { create: vi.fn() },
    $transaction:          vi.fn(),
  },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, POST } from '@/app/api/franchise/applications/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.FRANCHISE_ENABLED = 'true' })
afterEach(() => { delete process.env.FRANCHISE_ENABLED })

const post = (body: unknown) =>
  POST(new Request('http://x/api/franchise/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: 'op1' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'franchise' })
  db.operatorRole.findMany.mockResolvedValue([]) // role set = ['franchise']
  db.brand.findMany.mockResolvedValue([{ id: 'b1', name: 'Marco', emoji: '🍕' }])
  db.brand.findUnique.mockResolvedValue({ operatorId: 'op1' }) // the franchisor owns brand b1
  db.franchiseeApplication.findUnique.mockResolvedValue({ id: 'app1', status: 'pending', brandId: 'b1', restaurantId: 'r1', applicantOperatorId: 'opX' })
  db.franchiseeApplication.findMany.mockResolvedValue([])
  db.franchiseeApplication.update.mockResolvedValue({})
  db.restaurant.findUnique.mockResolvedValue({ operatorId: 'opX', name: 'Resto X', city: 'Paris', pointOfSaleId: null })
  db.restaurant.findMany.mockResolvedValue([])
  db.restaurant.updateMany.mockResolvedValue({ count: 1 })
  db.pointOfSale.create.mockResolvedValue({ id: 'pos1', name: 'Resto X', city: 'Paris' })
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))
})

describe('POST approve', () => {
  it('(b) brand owner approves → POS created (franchiseId=franchisor, brandId) + restaurant linked 1:1', async () => {
    const res = await post({ id: 'app1', action: 'approve' })
    expect(res.status).toBe(200)
    // POS belongs to the FRANCHISOR (session), tagged with the franchisor's brand.
    expect(db.pointOfSale.create.mock.calls[0][0].data).toMatchObject({ franchiseId: 'op1', brandId: 'b1' })
    // The APPLICANT's restaurant is claimed (cross-operator) — race-safe WHERE on the 1:1.
    expect(db.restaurant.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'r1', operatorId: 'opX', pointOfSaleId: null },
      data:  { pointOfSaleId: 'pos1' },
    })
    expect(db.franchiseeApplication.update.mock.calls[0][0].data).toMatchObject({ status: 'approved', pointOfSaleId: 'pos1' })
  })

  it('(d) cross-operator link only via this flow: POS.franchiseId != restaurant.operatorId, authorized by the candidacy', async () => {
    await post({ id: 'app1', action: 'approve' })
    const posFranchiseId = db.pointOfSale.create.mock.calls[0][0].data.franchiseId
    const claimedOperator = db.restaurant.updateMany.mock.calls[0][0].where.operatorId
    expect(posFranchiseId).toBe('op1')      // franchisor
    expect(claimedOperator).toBe('opX')     // applicant — different operator, by double accord
  })

  it('(b) NON-owner of the brand → 404, no POS, no link (no IDOR)', async () => {
    db.brand.findUnique.mockResolvedValue({ operatorId: 'op2' }) // someone else's brand
    const res = await post({ id: 'app1', action: 'approve' })
    expect(res.status).toBe(404)
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
    expect(db.restaurant.updateMany).not.toHaveBeenCalled()
  })

  it('1:1 race — restaurant linked between-time (updateMany count 0) → 409, candidacy not approved', async () => {
    db.restaurant.updateMany.mockResolvedValue({ count: 0 })
    const res = await post({ id: 'app1', action: 'approve' })
    expect(res.status).toBe(409)
  })

  it('restaurant already linked at pre-check → 409, no transaction', async () => {
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'opX', name: 'Resto X', city: 'Paris', pointOfSaleId: 'pos0' })
    const res = await post({ id: 'app1', action: 'approve' })
    expect(res.status).toBe(409)
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
  })

  it('already-decided candidacy → 409', async () => {
    db.franchiseeApplication.findUnique.mockResolvedValue({ id: 'app1', status: 'approved', brandId: 'b1', restaurantId: 'r1', applicantOperatorId: 'opX' })
    expect((await post({ id: 'app1', action: 'approve' })).status).toBe(409)
  })
})

describe('POST reject', () => {
  it('(c) brand owner rejects → status rejected, NO POS / NO link created', async () => {
    const res = await post({ id: 'app1', action: 'reject' })
    expect(res.status).toBe(200)
    expect(db.franchiseeApplication.update.mock.calls[0][0].data).toMatchObject({ status: 'rejected' })
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
    expect(db.restaurant.updateMany).not.toHaveBeenCalled()
  })
})

describe('auth / scope', () => {
  it('(e) unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await post({ id: 'app1', action: 'approve' })).status).toBe(401)
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
  })

  it('non-franchise role → 403', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    expect((await post({ id: 'app1', action: 'approve' })).status).toBe(403)
  })

  it('candidacy not found → 404', async () => {
    db.franchiseeApplication.findUnique.mockResolvedValue(null)
    expect((await post({ id: 'ghost', action: 'approve' })).status).toBe(404)
  })

  it('GET → only candidacies to MY brands', async () => {
    db.franchiseeApplication.findMany.mockResolvedValue([
      { id: 'app1', restaurantId: 'r1', brandId: 'b1', status: 'pending', message: null, createdAt: new Date(0), decidedAt: null },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.applications).toHaveLength(1)
    // scoped to the operator's OWN brands
    expect(db.brand.findMany.mock.calls[0][0].where).toEqual({ operatorId: 'op1' })
    expect(db.franchiseeApplication.findMany.mock.calls[0][0].where).toEqual({ brandId: { in: ['b1'] } })
  })

  it('GET unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})
