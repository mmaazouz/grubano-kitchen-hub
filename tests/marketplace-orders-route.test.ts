import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/marketplace/* place-order + discovery scoping (Slice 2, Agent 14) ────
// operatorId comes from the SESSION (never the body); discovery is active-only;
// items are scoped to the target supplier and snapshotted at order time.

const { db, getSession } = vi.hoisted(() => ({
  db: {
    operator:            { findUnique: vi.fn() },
    supplierProfile:     { findUnique: vi.fn(), findMany: vi.fn() },
    supplierCatalogItem: { findMany: vi.fn() },
    supplyOrder:         { create: vi.fn() },
  },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { POST } from '@/app/api/marketplace/orders/route'
import { GET as DISCOVER } from '@/app/api/marketplace/suppliers/route'

const post = (body: unknown) =>
  new Request('http://x/api/marketplace/orders', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { email: 'r@x.fr' } })
})

describe('POST /api/marketplace/orders — session-scoped + price snapshot', () => {
  it('places an order with operatorId FROM THE SESSION (body id ignored), snapshotting prices', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', status: 'active', minimumOrderCents: 0 })
    db.supplierCatalogItem.findMany.mockResolvedValue([{ id: 'a', name: 'Tomate', unit: 'kg', priceCents: 250, available: true }])
    db.supplyOrder.create.mockResolvedValue({ id: 'o1', status: 'placed', totalCents: 500 })

    const res = await POST(post({ supplierProfileId: 'sp1', lines: [{ catalogItemId: 'a', quantity: 2 }], operatorId: 'EVIL' }))
    expect(res.status).toBe(201)
    const data = db.supplyOrder.create.mock.calls[0][0].data
    expect(data.operatorId).toBe('op1') // session, not 'EVIL'
    expect(data.supplierProfileId).toBe('sp1')
    expect(data.totalCents).toBe(500) // 2 × 250
    expect(data.lines.createMany.data[0]).toMatchObject({ nameSnapshot: 'Tomate', unitPriceCents: 250, lineTotalCents: 500 })
    // the items query is scoped to the supplier + available
    expect(db.supplierCatalogItem.findMany.mock.calls[0][0].where).toMatchObject({ supplierProfileId: 'sp1', available: true })
  })

  it('401 anon, 403 non-restaurant, 400 inactive supplier, 400 item not in supplier', async () => {
    getSession.mockResolvedValue(null)
    expect((await POST(post({ supplierProfileId: 'sp1', lines: [{ catalogItemId: 'a', quantity: 1 }] }))).status).toBe(401)

    getSession.mockResolvedValue({ user: { email: 'r@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'consumer' })
    expect((await POST(post({ supplierProfileId: 'sp1', lines: [{ catalogItemId: 'a', quantity: 1 }] }))).status).toBe(403)

    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', status: 'pending' })
    expect((await POST(post({ supplierProfileId: 'sp1', lines: [{ catalogItemId: 'a', quantity: 1 }] }))).status).toBe(400)

    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', status: 'active', minimumOrderCents: 0 })
    db.supplierCatalogItem.findMany.mockResolvedValue([]) // item not found scoped to this supplier
    expect((await POST(post({ supplierProfileId: 'sp1', lines: [{ catalogItemId: 'a', quantity: 1 }] }))).status).toBe(400)
    expect(db.supplyOrder.create).not.toHaveBeenCalled()
  })

  it('enforces minimumOrderCents SERVER-SIDE (direct API call can not bypass the UI)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', status: 'active', minimumOrderCents: 1000 })
    db.supplierCatalogItem.findMany.mockResolvedValue([{ id: 'a', name: 'Tomate', unit: 'kg', priceCents: 250, available: true }])
    const res = await POST(post({ supplierProfileId: 'sp1', lines: [{ catalogItemId: 'a', quantity: 1 }] })) // 250 < 1000
    expect(res.status).toBe(400)
    expect(db.supplyOrder.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/marketplace/suppliers — discovery (active only)', () => {
  it('restaurant → 200 (active-only), consumer → 403, anon → 401', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.supplierProfile.findMany.mockResolvedValue([])
    expect((await DISCOVER()).status).toBe(200)
    // Agent 111: visibility gate = active AND coherence cleared (lean-pending suppliers hidden).
    expect(db.supplierProfile.findMany.mock.calls[0][0].where).toEqual({ status: 'active', marketplaceCoherencePending: false })

    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'consumer' })
    expect((await DISCOVER()).status).toBe(403)

    getSession.mockResolvedValue(null)
    expect((await DISCOVER()).status).toBe(401)
  })
})
