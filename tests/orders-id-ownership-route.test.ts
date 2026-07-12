import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── WP-SEC-02 (orders) — GET /api/orders/[id] + POST confirm ownership ─────────
// GET: a consumer reads ONLY their own order (byte-identical); a staff caller
// previously could read ANY order by id (IDOR) → now must OWN the order's
// establishment (admin superuser), cross-tenant → 404. confirm: consumer-owned,
// cross-tenant 403→404. Money fields on owner reads are asserted byte-identical.

const { db, getToken, resolveScope, emails } = vi.hoisted(() => ({
  db: {
    order:          { findUnique: vi.fn() },
    promotion:      { findUnique: vi.fn() },
    operator:       { findUnique: vi.fn() },
    emailDispatch:  { findFirst: vi.fn() },
  },
  getToken: vi.fn(),
  resolveScope: vi.fn(),
  emails: { sendOrderConfirmation: vi.fn(), sendRestaurantNewOrderEmail: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => emails)

import { GET } from '@/app/api/orders/[id]/route'
import { POST as CONFIRM } from '@/app/api/orders/[id]/confirm/route'

const get = (id = 'o1') => GET(new NextRequest(`http://x/api/orders/${id}`), { params: { id } })
const confirm = (id = 'o1') =>
  CONFIRM(new NextRequest(`http://x/api/orders/${id}/confirm`, { method: 'POST' }), { params: { id } })

// A superset object — Prisma `select`/`include` just pick fields, so one mock
// serves every findUnique shape the routes use.
const ORDER = {
  id: 'o1', status: 'preparing', consumerId: 'c1', restaurantId: 'r1',
  fulfillmentType: 'delivery', items: [{ name: 'Dish', qty: 2 }],
  subtotal: 20, deliveryFee: 2, total: 22, discount: 3,
  promotionId: null, loyaltyCreditCents: 120, pointsRedeemed: 40, tipCents: 150,
  estimatedTime: null, trackingUrl: null, deliveryAddress: '12 rue', paymentMethod: 'card',
  paymentStatus: 'paid', pointsEarned: 22, createdAt: new Date(0), updatedAt: new Date(0),
  restaurant: { id: 'r1', name: 'Resto', logo: null, address: 'a', city: 'Paris', deliveryTime: 20, operator: { email: 'op@x.fr' } },
}
const scopeOk = (over = {}) => ({ ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findUnique.mockResolvedValue(ORDER)
  db.promotion.findUnique.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue({ email: 'c@x.fr', name: 'Client' })
  db.emailDispatch.findFirst.mockResolvedValue(null)
  emails.sendOrderConfirmation.mockResolvedValue(undefined)
  emails.sendRestaurantNewOrderEmail.mockResolvedValue(undefined)
})

describe('GET /api/orders/[id]', () => {
  it('no token → 401', async () => {
    getToken.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })

  it('consumer-owner → 200, money fields byte-identical, scope NOT consulted', async () => {
    getToken.mockResolvedValue({ sub: 'c1', role: 'consumer' })
    const res = await get()
    expect(res.status).toBe(200)
    const { order } = await res.json()
    // money payload snapshot — proves the change is auth-only
    expect(order).toMatchObject({
      total: 22, subtotal: 20, deliveryFee: 2, discount: 3,
      loyaltyCreditCents: 120, pointsRedeemed: 40, tipCents: 150,
      paymentMethod: 'card', deliveryAddress: '12 rue', paymentStatus: 'paid',
    })
    expect(resolveScope).not.toHaveBeenCalled()
  })

  it('foreign consumer → 403 (resolveEstablishmentScope rejects non-operator)', async () => {
    getToken.mockResolvedValue({ sub: 'c2', role: 'consumer' })
    resolveScope.mockResolvedValue({ ok: false, status: 403, error: 'Accès refusé' })
    const res = await get()
    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('order')
  })

  it('operator OWNING the order restaurant → 200', async () => {
    getToken.mockResolvedValue({ sub: 'op1', role: 'restaurant' })
    resolveScope.mockResolvedValue(scopeOk({ ownedIds: ['r1'] }))
    expect((await get()).status).toBe(200)
  })

  it('operator NOT owning → 404, no order body (IDOR closed)', async () => {
    getToken.mockResolvedValue({ sub: 'op9', role: 'restaurant' })
    resolveScope.mockResolvedValue(scopeOk({ ownedIds: ['rX'] }))
    const res = await get()
    expect(res.status).toBe(404)
    expect(await res.json()).not.toHaveProperty('order')
  })

  it('admin → 200 on any order (superuser)', async () => {
    getToken.mockResolvedValue({ sub: 'adm', role: 'admin' })
    resolveScope.mockResolvedValue(scopeOk({ role: 'admin', ownedIds: [] }))
    expect((await get()).status).toBe(200)
  })
})

describe('POST /api/orders/[id]/confirm — consumer-owned', () => {
  it('no token → 401', async () => {
    getToken.mockResolvedValue(null)
    expect((await confirm()).status).toBe(401)
  })

  it('foreign consumer → 404 (was 403), no confirmation email', async () => {
    getToken.mockResolvedValue({ sub: 'other' })
    const res = await confirm()
    expect(res.status).toBe(404)
    expect(emails.sendOrderConfirmation).not.toHaveBeenCalled()
  })

  it('owner (paid) → 200 emailSent, paidCents byte-identical (2200)', async () => {
    getToken.mockResolvedValue({ sub: 'c1' })
    const res = await confirm()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ paymentStatus: 'paid', emailSent: true })
    expect(emails.sendOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ paidCents: 2200, dedupeKey: 'order:o1' }),
    )
  })

  it('owner, already dispatched → alreadySent, no duplicate send', async () => {
    getToken.mockResolvedValue({ sub: 'c1' })
    db.emailDispatch.findFirst.mockResolvedValue({ id: 'd1' })
    const res = await confirm()
    expect(await res.json()).toMatchObject({ emailSent: true, alreadySent: true })
    expect(emails.sendOrderConfirmation).not.toHaveBeenCalled()
  })
})
