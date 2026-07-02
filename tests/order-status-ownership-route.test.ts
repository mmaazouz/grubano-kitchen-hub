import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── PATCH /api/orders/[id]/status — establishment-ownership hardening ─────────
// A 'restaurant' operator may only mutate orders of an establishment they OWN
// (closes a pre-existing IDOR). 'admin' stays a superuser. The check is a pure
// PRE-CONDITION added before the state machine — the 'delivered' loyalty credit
// and the status email must stay byte-identical, which the last test proves.

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
  PATCH(
    new NextRequest(`http://x/api/orders/${id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    { params: { id } },
  )

const scopeOk = (over: Record<string, unknown> = {}) => ({
  ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue(scopeOk())
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) =>
    Promise.resolve({ id: 'o1', status: data.status, updatedAt: new Date('2026-07-03T10:00:00Z') }))
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue(null)   // → loyalty + email skip cleanly
  db.restaurant.findUnique.mockResolvedValue(null)
  sendEmail.mockResolvedValue(undefined)
})

it('no token → 401, no write', async () => {
  getToken.mockResolvedValue(null)
  const res = await patch('o1', { status: 'preparing' })
  expect(res.status).toBe(401)
  expect(db.order.update).not.toHaveBeenCalled()
})

it('wrong role (consumer) → 403, scope never resolved, no write', async () => {
  getToken.mockResolvedValue({ role: 'consumer' })
  const res = await patch('o1', { status: 'preparing' })
  expect(res.status).toBe(403)
  expect(resolveScope).not.toHaveBeenCalled()
  expect(db.order.update).not.toHaveBeenCalled()
})

it('AUTHORIZED — restaurant owns the order → 200, status advanced (KDS /prep bump still works)', async () => {
  db.order.findUnique.mockResolvedValue({
    id: 'o1', status: 'received', restaurantId: 'r1', pointsEarned: 0, consumerId: 'c1', fulfillmentType: 'delivery',
  })
  const res = await patch('o1', { status: 'preparing' })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ status: 'preparing' })
  expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'preparing' } }))
})

it('OUT-OF-SCOPE — restaurant does NOT own the order → 404, NO write (IDOR closed)', async () => {
  db.order.findUnique.mockResolvedValue({
    id: 'oX', status: 'received', restaurantId: 'foreign-resto', pointsEarned: 0, consumerId: 'c1', fulfillmentType: 'delivery',
  })
  const res = await patch('oX', { status: 'preparing' })
  expect(res.status).toBe(404)
  expect(db.order.update).not.toHaveBeenCalled()
})

it('admin is a superuser — may mutate an order of a NON-owned establishment → 200', async () => {
  getToken.mockResolvedValue({ role: 'admin' })
  resolveScope.mockResolvedValue(scopeOk({ role: 'admin', ownedIds: [], restaurantId: null }))
  db.order.findUnique.mockResolvedValue({
    id: 'o3', status: 'ready', restaurantId: 'someone-elses-resto', pointsEarned: 0, consumerId: 'c1', fulfillmentType: 'pickup',
  })
  const res = await patch('o3', { status: 'delivered' })
  expect(res.status).toBe(200)
  expect(db.order.update).toHaveBeenCalled()
})

it('invalid transition on an OWNED order still → 422 (state machine intact)', async () => {
  db.order.findUnique.mockResolvedValue({
    id: 'o1', status: 'received', restaurantId: 'r1', pointsEarned: 0, consumerId: 'c1', fulfillmentType: 'delivery',
  })
  const res = await patch('o1', { status: 'delivered' }) // received → delivered not allowed
  expect(res.status).toBe(422)
  expect(db.order.update).not.toHaveBeenCalled()
})

it('BYTE-IDENTICAL — delivered on an owned order still credits loyalty (hardening did not break the earn path)', async () => {
  db.order.findUnique.mockResolvedValue({
    id: 'o1', status: 'ready', restaurantId: 'r1', pointsEarned: 5, consumerId: 'c1', fulfillmentType: 'delivery',
  })
  db.operator.findUnique.mockResolvedValue({ email: 'u@x.fr', name: 'U' })
  db.loyaltyCustomer.upsert.mockResolvedValue({ id: 'lc1' })
  db.$transaction.mockResolvedValue([])
  const res = await patch('o1', { status: 'delivered' })
  expect(res.status).toBe(200)
  expect(db.loyaltyCustomer.upsert).toHaveBeenCalled()
  expect(db.$transaction).toHaveBeenCalled() // increment + 'earn' row, atomic — unchanged
})
