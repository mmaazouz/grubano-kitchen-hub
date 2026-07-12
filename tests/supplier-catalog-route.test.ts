import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/supplier/catalog scoping + ownership isolation (Slice 1, Agent 14) ───
// The supplierProfileId is ALWAYS derived from the session (callerSupplierProfile),
// never the body — so a supplier can only ever touch its OWN items. PUT/DELETE
// enforce ownership; a non-active profile cannot mutate.

const { db, caller } = vi.hoisted(() => ({
  db: {
    supplierCatalogItem: {
      create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(),
    },
  },
  caller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-account', () => ({ callerSupplierProfile: caller }))

import { GET, POST, PUT, DELETE } from '@/app/api/supplier/catalog/route'

const post = (body: unknown) =>
  new Request('http://x/api/supplier/catalog', { method: 'POST', body: JSON.stringify(body) })
const del = (id: string) =>
  new Request(`http://x/api/supplier/catalog?id=${id}`, { method: 'DELETE' })

beforeEach(() => vi.clearAllMocks())

describe('POST — scopes supplierProfileId to the SESSION, ignoring the body', () => {
  it('creates with the caller profile id (a body-supplied id is stripped), euros→cents', async () => {
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.supplierCatalogItem.create.mockResolvedValue({ id: 'i1' })
    const res = await POST(post({ name: 'Tomate', priceEur: 2.5, unit: 'kg', supplierProfileId: 'EVIL' }))
    expect(res.status).toBe(201)
    const data = db.supplierCatalogItem.create.mock.calls[0][0].data
    expect(data.supplierProfileId).toBe('p1')
    expect(data.priceCents).toBe(250)
  })

  it('401 when no supplier profile; 403 when the profile is not active', async () => {
    caller.mockResolvedValue(null)
    expect((await POST(post({ name: 'X', priceEur: 1, unit: 'kg' }))).status).toBe(401)
    caller.mockResolvedValue({ id: 'p1', status: 'pending' })
    expect((await POST(post({ name: 'X', priceEur: 1, unit: 'kg' }))).status).toBe(403)
    expect(db.supplierCatalogItem.create).not.toHaveBeenCalled()
  })

  it('400 on invalid input (unknown unit)', async () => {
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    expect((await POST(post({ name: 'X', priceEur: 1, unit: 'tonne' }))).status).toBe(400)
  })
})

describe('PUT / DELETE — ownership isolation between suppliers', () => {
  it('PUT 403 when the item belongs to ANOTHER supplier (no update)', async () => {
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.supplierCatalogItem.findUnique.mockResolvedValue({ supplierProfileId: 'p2' })
    const res = await PUT(post({ id: 'i9', name: 'Hijack' }))
    expect(res.status).toBe(403)
    expect(db.supplierCatalogItem.update).not.toHaveBeenCalled()
  })

  it('PUT updates the caller’s own item (euros→cents on price change)', async () => {
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.supplierCatalogItem.findUnique.mockResolvedValue({ supplierProfileId: 'p1' })
    db.supplierCatalogItem.update.mockResolvedValue({ id: 'i1' })
    const res = await PUT(post({ id: 'i1', priceEur: 9 }))
    expect(res.status).toBe(200)
    expect(db.supplierCatalogItem.update.mock.calls[0][0].data.priceCents).toBe(900)
  })

  it('DELETE 403 for another supplier’s item, 200 for the caller’s own', async () => {
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.supplierCatalogItem.findUnique.mockResolvedValue({ supplierProfileId: 'p2' })
    expect((await DELETE(del('i9'))).status).toBe(403)
    expect(db.supplierCatalogItem.delete).not.toHaveBeenCalled()

    db.supplierCatalogItem.findUnique.mockResolvedValue({ supplierProfileId: 'p1' })
    db.supplierCatalogItem.delete.mockResolvedValue({})
    expect((await DELETE(del('i1'))).status).toBe(200)
  })
})

describe('GET — lists ONLY the caller’s catalogue', () => {
  it('scopes findMany to the caller profile id', async () => {
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.supplierCatalogItem.findMany.mockResolvedValue([])
    await GET()
    expect(db.supplierCatalogItem.findMany.mock.calls[0][0].where).toEqual({ supplierProfileId: 'p1' })
  })

  it('401 when not a supplier', async () => {
    caller.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})
