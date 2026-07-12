import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Cross-tenant API audit fixes (systematic /api/* sweep) ─────────────────────
// Confirmed HIGH leaks closed: loyalty/validate (unauth money-write),
// stocks/update-ai (unauth cross-brand write), suppliers + suppliers/orders
// (unauth read of supplier PII/prices + forged orders). Every one now requires
// the connected restaurateur (restaurant/admin); writes are brand-owner-fenced.

const { db, scope, llm, mailer } = vi.hoisted(() => ({
  db: {
    loyaltyCustomer: { findUnique: vi.fn() },
    loyaltyOrder:    { findUnique: vi.fn() },
    brand:           { findFirst: vi.fn() },
    stockItem:       { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    supplier:        { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    supplierOrder:   { findMany: vi.fn(), create: vi.fn() },
    $transaction:    vi.fn(async (ops: unknown[]) => ops.map(() => ({ id: 'o1' }))),
  },
  scope: { resolveEstablishmentScope: vi.fn() },
  llm:   { llmComplete: vi.fn(), LlmQuotaError: class LlmQuotaError extends Error {} },
  mailer: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/establishment-scope', () => scope)
vi.mock('@/lib/llm', () => llm)
vi.mock('nodemailer', () => ({ default: mailer }))

import { POST as loyaltyValidate } from '@/app/api/loyalty/validate/route'
import { POST as stocksAI } from '@/app/api/stocks/update-ai/route'
import { GET as suppliersGET, POST as suppliersPOST } from '@/app/api/suppliers/route'
import { GET as supOrdersGET, POST as supOrdersPOST } from '@/app/api/suppliers/orders/route'

const OK = { ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1' }
const DENY = { ok: false, status: 401, error: 'Non autorisé' }
const post = (url: string, body: unknown) => new Request(url, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  db.supplier.findMany.mockResolvedValue([])
  db.supplierOrder.findMany.mockResolvedValue([])
})

describe('POST /api/loyalty/validate — auth + brand tenant scope (money write)', () => {
  it('anonymous → 401, no loyalty mutation', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(DENY)
    const res = await loyaltyValidate(post('http://x/api/loyalty/validate', { email: 'v@x.fr', uberOrderNumber: 'A123', amount: 20, brandName: 'Gnocchi' }) as never)
    expect(res.status).toBe(401)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('restaurant → brand resolved WITHIN own tenant; foreign brand → 404, no write', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK)
    db.loyaltyCustomer.findUnique.mockResolvedValue({ id: 'c1', pointsBalance: 0 })
    db.loyaltyOrder.findUnique.mockResolvedValue(null)
    db.brand.findFirst.mockResolvedValue(null)   // not one of the caller's brands
    const res = await loyaltyValidate(post('http://x/api/loyalty/validate', { email: 'c@x.fr', uberOrderNumber: 'A123', amount: 20, brandName: 'OtherResto' }) as never)
    expect(res.status).toBe(404)
    expect(db.brand.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ operatorId: 'op1' }) }))
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/stocks/update-ai — auth + brand ownership (unauth write closed)', () => {
  it('anonymous → 401, LLM never called', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(DENY)
    const res = await stocksAI(post('http://x/api/stocks/update-ai', { text: 'riz 5 kg', brandId: 'b1' }))
    expect(res.status).toBe(401)
    expect(llm.llmComplete).not.toHaveBeenCalled()
    expect(db.stockItem.create).not.toHaveBeenCalled()
  })
  it('restaurant + FOREIGN brandId → 403, no stock write', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK)
    llm.llmComplete.mockResolvedValue({ text: '[{"name":"riz","quantity":5,"unit":"kg"}]' })
    db.brand.findFirst.mockResolvedValue(null)   // brandId not owned by caller
    const res = await stocksAI(post('http://x/api/stocks/update-ai', { text: 'riz 5 kg', brandId: 'foreign' }))
    expect(res.status).toBe(403)
    expect(db.stockItem.create).not.toHaveBeenCalled()
    expect(db.stockItem.update).not.toHaveBeenCalled()
  })
})

describe('/api/suppliers + /api/suppliers/orders — auth required (unauth read/write closed)', () => {
  it('suppliers GET anonymous → 401, no db read', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(DENY)
    const res = await suppliersGET()
    expect(res.status).toBe(401)
    expect(db.supplier.findMany).not.toHaveBeenCalled()
  })
  it('suppliers POST anonymous → 401, no create', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(DENY)
    const res = await suppliersPOST(post('http://x/api/suppliers', { name: 'X' }))
    expect(res.status).toBe(401)
    expect(db.supplier.create).not.toHaveBeenCalled()
  })
  it('suppliers/orders GET anonymous → 401, no db read', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(DENY)
    const res = await supOrdersGET(new Request('http://x/api/suppliers/orders'))
    expect(res.status).toBe(401)
    expect(db.supplierOrder.findMany).not.toHaveBeenCalled()
  })
  it('suppliers/orders POST anonymous → 401, no order forged', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(DENY)
    const res = await supOrdersPOST(post('http://x/api/suppliers/orders', { supplierId: 's1', items: [{ name: 'x', quantity: 1, unit: 'kg', price: 1 }], total: 1 }))
    expect(res.status).toBe(401)
    expect(db.supplierOrder.create).not.toHaveBeenCalled()
  })

  it('suppliers GET authenticated → 200', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue(OK)
    const res = await suppliersGET()
    expect(res.status).toBe(200)
    expect(db.supplier.findMany).toHaveBeenCalled()
  })
})
