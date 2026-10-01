import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Cross-tenant API scoping — analytics / dashboard / stocks ──────────────────
// Same family as the /api/briefing leak: these endpoints returned (or mutated)
// data belonging to OTHER restaurants without auth/scoping. Now every one requires
// the connected restaurateur and is fenced to their OWN brands/customers.

const { db, scope, custscope } = vi.hoisted(() => ({
  db: {
    loyaltyOrder:    { findMany: vi.fn() },
    loyaltyCustomer: { count: vi.fn() },
    brand:           { findMany: vi.fn() },
    stockItem:       { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
  scope: { resolveEstablishmentScope: vi.fn() },
  custscope: { loyaltyCustomerWhereForOperator: vi.fn(async () => ({ OR: [{ orders: { some: { brand: { operatorId: 'op1' } } } }] })) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/establishment-scope', () => scope)
vi.mock('@/lib/customer-scope', () => custscope)

import { GET as analyticsGET } from '@/app/api/analytics/route'
import { GET as dashboardGET } from '@/app/api/dashboard/route'
import { GET as stocksGET, POST as stocksPOST } from '@/app/api/stocks/route'

const OK_SCOPE = { ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1' }
const stocksReq = (url = 'http://x/api/stocks', init?: RequestInit) => new Request(url, init)

beforeEach(() => {
  vi.clearAllMocks()
  db.loyaltyOrder.findMany.mockResolvedValue([])
  db.loyaltyCustomer.count.mockResolvedValue(0)
  db.brand.findMany.mockResolvedValue([{ id: 'b1' }])
  db.stockItem.findMany.mockResolvedValue([])
})

describe('GET /api/analytics — auth + brand scoping', () => {
  it('anonymous → 401, NO db read', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: false, status: 401, error: 'Non autorisé' })
    const res = await analyticsGET()
    expect(res.status).toBe(401)
    expect(db.loyaltyOrder.findMany).not.toHaveBeenCalled()
  })
  it('restaurant → loyaltyOrder + brand queries fenced to brand.operatorId', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK_SCOPE)
    const res = await analyticsGET()
    expect(res.status).toBe(200)
    for (const call of db.loyaltyOrder.findMany.mock.calls) {
      expect(call[0].where.brand).toEqual({ operatorId: 'op1' })
    }
    expect(db.brand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { operatorId: 'op1' } }))
  })
})

describe('GET /api/dashboard — auth + brand/customer scoping', () => {
  it('anonymous → 401', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: false, status: 401, error: 'Non autorisé' })
    const res = await dashboardGET()
    expect(res.status).toBe(401)
    expect(db.loyaltyOrder.findMany).not.toHaveBeenCalled()
  })
  it('restaurant → orders fenced to brand.operatorId AND customer count uses the tenant fence', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK_SCOPE)
    const res = await dashboardGET()
    expect(res.status).toBe(200)
    for (const call of db.loyaltyOrder.findMany.mock.calls) {
      expect(call[0].where.brand).toEqual({ operatorId: 'op1' })
    }
    expect(custscope.loyaltyCustomerWhereForOperator).toHaveBeenCalledWith('op1')
    expect(db.loyaltyCustomer.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ orders: { some: { brand: { operatorId: 'op1' } } } }] } }),
    )
  })
})

describe('/api/stocks — auth + brand ownership (IDOR + unauth-write closed)', () => {
  it('GET anonymous → 401, NO db read', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: false, status: 401, error: 'Non autorisé' })
    const res = await stocksGET(stocksReq())
    expect(res.status).toBe(401)
    expect(db.stockItem.findMany).not.toHaveBeenCalled()
  })

  it('GET → scoped to owned brands when no brandId', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK_SCOPE)
    await stocksGET(stocksReq())
    expect(db.stockItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brandId: { in: ['b1'] } } }),
    )
  })

  it('GET ?brandId= for a FOREIGN brand → matches nothing (no IDOR)', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK_SCOPE)
    await stocksGET(stocksReq('http://x/api/stocks?brandId=foreign'))
    const call = db.stockItem.findMany.mock.calls[0][0]
    expect(call.where).toEqual({ brandId: '__none__' })
  })

  it('POST anonymous → 401, NO write', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: false, status: 401, error: 'Non autorisé' })
    const res = await stocksPOST(stocksReq('http://x/api/stocks', {
      method: 'POST', body: JSON.stringify({ brandId: 'b1', name: 'Farine', quantity: 5 }),
    }))
    expect(res.status).toBe(401)
    expect(db.stockItem.create).not.toHaveBeenCalled()
  })

  it('POST create on a FOREIGN brand → 403, NO write', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK_SCOPE)
    const res = await stocksPOST(stocksReq('http://x/api/stocks', {
      method: 'POST', body: JSON.stringify({ brandId: 'foreign-brand', name: 'Farine', quantity: 5 }),
    }))
    expect(res.status).toBe(403)
    expect(db.stockItem.create).not.toHaveBeenCalled()
  })

  it('POST update of an item on a FOREIGN brand → 403, NO write', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK_SCOPE)
    db.stockItem.findUnique.mockResolvedValue({ brandId: 'foreign-brand' })
    const res = await stocksPOST(stocksReq('http://x/api/stocks', {
      method: 'POST', body: JSON.stringify({ id: 'it1', brandId: 'b1', name: 'Farine', quantity: 5 }),
    }))
    expect(res.status).toBe(403)
    expect(db.stockItem.update).not.toHaveBeenCalled()
  })

  it('POST create on an OWNED brand → 201', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK_SCOPE)
    db.stockItem.create.mockResolvedValue({ id: 'new', brandId: 'b1' })
    const res = await stocksPOST(stocksReq('http://x/api/stocks', {
      method: 'POST', body: JSON.stringify({ brandId: 'b1', name: 'Farine', quantity: 5 }),
    }))
    expect(res.status).toBe(201)
    expect(db.stockItem.create).toHaveBeenCalled()
  })
})
