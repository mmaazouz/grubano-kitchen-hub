import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Supply order status routes (B2B Slice 3, Agent 14) ────────────────────────
// Supplier advances its OWN orders along the state machine; resto cancels its OWN
// orders only while placed. Ownership + valid-transition enforced server-side.

const { db, supplierCaller, operatorCaller } = vi.hoisted(() => ({
  db: { supplyOrder: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() } },
  supplierCaller: vi.fn(),
  operatorCaller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-account', () => ({ callerSupplierProfile: supplierCaller }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: operatorCaller }))

import { PATCH as SUPPLIER_PATCH } from '@/app/api/supplier/orders/[id]/route'
import { PATCH as RESTO_PATCH } from '@/app/api/marketplace/orders/[id]/route'
import { GET as RESTO_GET } from '@/app/api/marketplace/orders/route'

const sPatch = (id: string, body: unknown) =>
  new Request(`http://x/api/supplier/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
const rPatch = (id: string, body: unknown) =>
  new Request(`http://x/api/marketplace/orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
const params = (id: string) => ({ params: { id } })

beforeEach(() => vi.clearAllMocks())

describe('PATCH /api/supplier/orders/[id] — supplier advances OWN order', () => {
  it('accepts a valid transition (placed → confirmed)', async () => {
    supplierCaller.mockResolvedValue({ id: 'sp1', status: 'active' })
    db.supplyOrder.findUnique.mockResolvedValue({ supplierProfileId: 'sp1', status: 'placed' })
    db.supplyOrder.update.mockResolvedValue({ id: 'o1', status: 'confirmed' })
    const res = await SUPPLIER_PATCH(sPatch('o1', { status: 'confirmed' }), params('o1'))
    expect(res.status).toBe(200)
    expect(db.supplyOrder.update.mock.calls[0][0].data).toEqual({ status: 'confirmed' })
  })

  it('409 on an INVALID transition (placed → delivered), no write', async () => {
    supplierCaller.mockResolvedValue({ id: 'sp1', status: 'active' })
    db.supplyOrder.findUnique.mockResolvedValue({ supplierProfileId: 'sp1', status: 'placed' })
    const res = await SUPPLIER_PATCH(sPatch('o1', { status: 'delivered' }), params('o1'))
    expect(res.status).toBe(409)
    expect(db.supplyOrder.update).not.toHaveBeenCalled()
  })

  it('403 when the order belongs to ANOTHER supplier; 401 anon', async () => {
    supplierCaller.mockResolvedValue({ id: 'sp1', status: 'active' })
    db.supplyOrder.findUnique.mockResolvedValue({ supplierProfileId: 'sp2', status: 'placed' })
    expect((await SUPPLIER_PATCH(sPatch('o1', { status: 'confirmed' }), params('o1'))).status).toBe(403)
    supplierCaller.mockResolvedValue(null)
    expect((await SUPPLIER_PATCH(sPatch('o1', { status: 'confirmed' }), params('o1'))).status).toBe(401)
  })
})

describe('PATCH /api/marketplace/orders/[id] — resto cancels OWN order', () => {
  it('cancels while placed; 409 once confirmed', async () => {
    operatorCaller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.supplyOrder.findUnique.mockResolvedValue({ operatorId: 'op1', status: 'placed' })
    db.supplyOrder.update.mockResolvedValue({ id: 'o1', status: 'cancelled' })
    expect((await RESTO_PATCH(rPatch('o1', { status: 'cancelled' }), params('o1'))).status).toBe(200)

    db.supplyOrder.findUnique.mockResolvedValue({ operatorId: 'op1', status: 'confirmed' })
    const res = await RESTO_PATCH(rPatch('o1', { status: 'cancelled' }), params('o1'))
    expect(res.status).toBe(409)
  })

  it('403 cancelling ANOTHER resto’s order', async () => {
    operatorCaller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.supplyOrder.findUnique.mockResolvedValue({ operatorId: 'op2', status: 'placed' })
    expect((await RESTO_PATCH(rPatch('o1', { status: 'cancelled' }), params('o1'))).status).toBe(403)
  })
})

describe('GET /api/marketplace/orders — resto history scoped', () => {
  it('scopes findMany to the session operator', async () => {
    operatorCaller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.supplyOrder.findMany.mockResolvedValue([])
    const res = await RESTO_GET()
    expect(res.status).toBe(200)
    expect(db.supplyOrder.findMany.mock.calls[0][0].where).toEqual({ operatorId: 'op1' })
  })

  it('401 anon, 403 non-restaurant', async () => {
    operatorCaller.mockResolvedValue(null)
    expect((await RESTO_GET()).status).toBe(401)
    operatorCaller.mockResolvedValue({ id: 'op1', role: 'consumer' })
    expect((await RESTO_GET()).status).toBe(403)
  })
})
