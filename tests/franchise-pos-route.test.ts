import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── /api/franchise/pos (+ /[id]) — franchisor POS CRUD (B3, Agent 44) ────────────
// Owner-scoped (franchiseId = SESSION operator, never a client id → no IDOR),
// role-gated ('franchise'), 1:1 Restaurant↔POS, ownership-validated links. Prisma +
// next-auth mocked (same style as franchise-profile-route).

const { db, getSession } = vi.hoisted(() => ({
  db: {
    operator:         { findUnique: vi.fn() },
    operatorRole:     { findMany: vi.fn() },
    pointOfSale:      { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    restaurant:       { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    brand:            { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction:     vi.fn(),
  },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, POST } from '@/app/api/franchise/pos/route'
import { PATCH, DELETE } from '@/app/api/franchise/pos/[id]/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.FRANCHISE_ENABLED = 'true' })
afterEach(() => { delete process.env.FRANCHISE_ENABLED })

const post = (body: unknown) =>
  POST(new Request('http://x/api/franchise/pos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/franchise/pos/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } })
const del = (id: string) =>
  DELETE(new Request(`http://x/api/franchise/pos/${id}`, { method: 'DELETE' }), { params: { id } })

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: 'op1' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'franchise' })
  db.operatorRole.findMany.mockResolvedValue([]) // role set = ['franchise']
  db.pointOfSale.findMany.mockResolvedValue([])
  db.restaurant.findMany.mockResolvedValue([])
  db.brand.findMany.mockResolvedValue([])
  db.pointOfSale.create.mockResolvedValue({ id: 'pos1', name: 'POS Orange', city: 'Orange', isActive: true })
  db.restaurant.updateMany.mockResolvedValue({ count: 1 })
  db.restaurant.update.mockResolvedValue({})
  db.pointOfSale.update.mockResolvedValue({})
  db.pointOfSale.delete.mockResolvedValue({})
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))
})

describe('GET /api/franchise/pos', () => {
  it('(g) returns ONLY the session operator’s POS / restaurants / brands', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(db.pointOfSale.findMany.mock.calls[0][0].where).toEqual({ franchiseId: 'op1' })
    expect(db.restaurant.findMany.mock.calls[0][0].where).toEqual({ operatorId: 'op1', archivedAt: null })
    expect(db.brand.findMany.mock.calls[0][0].where).toEqual({ operatorId: 'op1' })
  })
  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('non-franchise role → 403', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    expect((await GET()).status).toBe(403)
  })
})

describe('POST /api/franchise/pos', () => {
  it('(a) creates a POS for the session franchisor, linked to its OWN restaurant', async () => {
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', pointOfSaleId: null })
    const res = await post({ name: 'POS Orange', city: 'Orange', restaurantId: 'r1' })
    expect(res.status).toBe(201)
    expect(db.pointOfSale.create.mock.calls[0][0].data.franchiseId).toBe('op1') // owner, never client
    expect(db.restaurant.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'r1', operatorId: 'op1', pointOfSaleId: null }, data: { pointOfSaleId: 'pos1' },
    })
  })

  it('(b) linking a restaurant NOT owned by the operator → 403, NO create', async () => {
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'other', pointOfSaleId: null })
    expect((await post({ name: 'POS', restaurantId: 'r-other' })).status).toBe(403)
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
  })

  it('(c) 1:1 — linking a restaurant already linked to another POS → 409, NO create', async () => {
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', pointOfSaleId: 'posX' })
    expect((await post({ name: 'POS', restaurantId: 'r1' })).status).toBe(409)
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
  })

  it('linking a brand NOT owned → 403, NO create', async () => {
    db.brand.findUnique.mockResolvedValue({ operatorId: 'other' })
    expect((await post({ name: 'POS', brandId: 'b-other' })).status).toBe(403)
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
  })

  it('1:1 race — claim loses (updateMany count 0) → 409, rolled back', async () => {
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'op1', pointOfSaleId: null })
    db.restaurant.updateMany.mockResolvedValue({ count: 0 }) // a rival linked it first
    expect((await post({ name: 'POS', restaurantId: 'r1' })).status).toBe(409)
  })

  it('creates a standalone POS (no restaurant/brand) → 201', async () => {
    const res = await post({ name: 'POS seul' })
    expect(res.status).toBe(201)
    expect(db.restaurant.updateMany).not.toHaveBeenCalled()
  })

  it('invalid body (name too short) → 400, no create', async () => {
    expect((await post({ name: 'x' })).status).toBe(400)
    expect(db.pointOfSale.create).not.toHaveBeenCalled()
  })

  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await post({ name: 'POS' })).status).toBe(401)
  })
})

describe('PATCH /api/franchise/pos/[id]', () => {
  it('(d) NO IDOR — editing another franchisor’s POS → 404', async () => {
    db.pointOfSale.findUnique.mockResolvedValue({ id: 'pos9', franchiseId: 'other', restaurant: null })
    expect((await patch('pos9', { name: 'Hack' })).status).toBe(404)
    expect(db.pointOfSale.update).not.toHaveBeenCalled()
  })

  it('edits an own POS scalar fields', async () => {
    db.pointOfSale.findUnique.mockResolvedValue({ id: 'pos1', franchiseId: 'op1', restaurant: null })
    const res = await patch('pos1', { name: 'POS Avignon', city: 'Avignon' })
    expect(res.status).toBe(200)
    expect(db.pointOfSale.update.mock.calls[0][0].data).toMatchObject({ name: 'POS Avignon', city: 'Avignon' })
  })

  it('re-link to a restaurant not owned → 403', async () => {
    db.pointOfSale.findUnique.mockResolvedValue({ id: 'pos1', franchiseId: 'op1', restaurant: null })
    db.restaurant.findUnique.mockResolvedValue({ operatorId: 'other', pointOfSaleId: null })
    expect((await patch('pos1', { restaurantId: 'r-other' })).status).toBe(403)
  })

  it('unlink (restaurantId:null) clears the linked restaurant', async () => {
    db.pointOfSale.findUnique.mockResolvedValue({ id: 'pos1', franchiseId: 'op1', restaurant: { id: 'r1' } })
    const res = await patch('pos1', { restaurantId: null })
    expect(res.status).toBe(200)
    expect(db.restaurant.update.mock.calls[0][0]).toEqual({ where: { id: 'r1' }, data: { pointOfSaleId: null } })
  })
})

describe('DELETE /api/franchise/pos/[id]', () => {
  it('(d) NO IDOR — deleting another franchisor’s POS → 404', async () => {
    db.pointOfSale.findUnique.mockResolvedValue({ id: 'pos9', franchiseId: 'other', restaurant: null, _count: { orders: 0 } })
    expect((await del('pos9')).status).toBe(404)
    expect(db.pointOfSale.delete).not.toHaveBeenCalled()
  })

  it('(f) deleting an own POS unlinks the restaurant FIRST, then deletes', async () => {
    db.pointOfSale.findUnique.mockResolvedValue({ id: 'pos1', franchiseId: 'op1', restaurant: { id: 'r1' }, _count: { orders: 0 } })
    const res = await del('pos1')
    expect(res.status).toBe(200)
    expect(db.restaurant.update.mock.calls[0][0]).toEqual({ where: { id: 'r1' }, data: { pointOfSaleId: null } })
    expect(db.pointOfSale.delete.mock.calls[0][0]).toEqual({ where: { id: 'pos1' } })
  })

  it('refuses to delete a POS that has orders → 409, no delete', async () => {
    db.pointOfSale.findUnique.mockResolvedValue({ id: 'pos1', franchiseId: 'op1', restaurant: null, _count: { orders: 3 } })
    expect((await del('pos1')).status).toBe(409)
    expect(db.pointOfSale.delete).not.toHaveBeenCalled()
  })

  it('non-franchise role → 403', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'creator' })
    expect((await del('pos1')).status).toBe(403)
  })
})
