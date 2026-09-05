import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── P0 TRUTHFULNESS T1 (2026-09-05) — `picked_up` is the courier hand-off and is REFUSED
// for a non-delivery order. Before: ready → picked_up was allowed for ANY fulfillment type
// (characterised by the pre-fix source-scan below), so a Click & collect order could email
// « en route — elle arrive bientôt ». Route-level mocks mirror order-status-ownership-route.

const { db, getToken, resolveScope, sendEmail } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    $transaction:       vi.fn(),
  },
  getToken:     vi.fn(),
  resolveScope: vi.fn(),
  sendEmail:    vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: sendEmail }))

import { PATCH } from '@/app/api/orders/[id]/status/route'

const patch = (id: string, body: Record<string, unknown>) =>
  PATCH(new NextRequest(`http://x/api/orders/${id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } })

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1', status: 'ready', restaurantId: 'r1', pointsEarned: 0, consumerId: 'c1', fulfillmentType: 'pickup', paymentStatus: 'paid', total: 25.5, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue({ ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1' })
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) => Promise.resolve({ id: 'o1', status: data.status, updatedAt: new Date() }))
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue({ email: 'lea@example.invalid', name: 'Léa' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
  sendEmail.mockResolvedValue({ status: 'sent' })
})

describe('pickup order — picked_up refused, delivered is the hand-off', () => {
  it('pickup + ready → picked_up ⇒ 422, NO write, NO email', async () => {
    db.order.findUnique.mockResolvedValue(order())
    const res = await patch('o1', { status: 'picked_up' })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('commande à retirer')
    expect(body.allowed).not.toContain('picked_up')
    expect(db.order.update).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('pickup + ready → delivered (« remise au client ») ⇒ 200 and the status email carries the pickup type', async () => {
    db.order.findUnique.mockResolvedValue(order())
    const res = await patch('o1', { status: 'delivered' })
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered', fulfillmentType: 'pickup' }))
  })

  it('pickup + preparing → ready ⇒ 200 (unchanged path)', async () => {
    db.order.findUnique.mockResolvedValue(order({ status: 'preparing' }))
    expect((await patch('o1', { status: 'ready' })).status).toBe(200)
  })

  it('legacy/unknown fulfillment type (not delivery) → picked_up also refused', async () => {
    db.order.findUnique.mockResolvedValue(order({ fulfillmentType: 'dinein' }))
    expect((await patch('o1', { status: 'picked_up' })).status).toBe(422)
    expect(db.order.update).not.toHaveBeenCalled()
  })
})

describe('delivery order (OUT of beta, code preserved) — the courier leg still exists', () => {
  it('delivery + ready → picked_up ⇒ 200 (state machine unchanged for delivery)', async () => {
    db.order.findUnique.mockResolvedValue(order({ fulfillmentType: 'delivery' }))
    const res = await patch('o1', { status: 'picked_up' })
    expect(res.status).toBe(200)
    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'picked_up' } }))
  })
})

describe('source-scan — the guard exists and the pinned TRANSITIONS constant is intact', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/orders/[id]/status/route.ts'), 'utf8')
  it('guard present after the state-machine check', () => {
    expect(/newStatus === 'picked_up' && order\.fulfillmentType !== 'delivery'/.test(route)).toBe(true)
    expect(route.indexOf("newStatus === 'picked_up' && order.fulfillmentType") > route.indexOf('const allowed = TRANSITIONS[order.status]')).toBe(true)
  })
  it('TRANSITIONS constant unchanged (ready still lists picked_up for delivery orders)', () => {
    expect(/const TRANSITIONS: Record<string, string\[\]> = \{/.test(route)).toBe(true)
    expect(/ready:\s+\['picked_up', 'delivered', 'cancelled'\]/.test(route)).toBe(true)
  })
})
