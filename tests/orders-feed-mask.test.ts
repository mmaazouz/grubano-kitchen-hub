import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/orders-feed — customer identity is MASKED, contact-free ────────────────
// The operator Orders screen must never expose a delivery customer's email or
// phone. buildOrderViews must emit a MASKED name only (first + last initial).

const { db } = vi.hoisted(() => ({
  db: {
    order:    { findMany: vi.fn() },
    menuItem: { findMany: vi.fn() },
    operator: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { buildOrderViews } from '@/lib/orders-feed'

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findMany.mockResolvedValue([
    { id: 'o1', status: 'received', fulfillmentType: 'delivery', subtotal: 20, deliveryFee: 2, total: 22,
      referralCode: null, consumerId: 'cons1', items: [{ name: 'Burger', qty: 1 }], createdAt: new Date('2026-07-09') },
  ])
  db.menuItem.findMany.mockResolvedValue([])
  db.operator.findMany.mockResolvedValue([{ id: 'cons1', name: 'Mohammed Maazouz' }])
})

describe('buildOrderViews customer masking', () => {
  it('emits a MASKED name and no email/phone', async () => {
    const views = await buildOrderViews({ restaurantId: 'r1', operatorId: 'op1', locale: 'fr' })
    const cust = views[0]!.customer!
    expect(cust.name).toBe('Mohammed M.')
    expect(cust).not.toHaveProperty('email')
    expect(cust).not.toHaveProperty('phone')
  })

  it('never SELECTs email/phone from the DB (masking at source)', async () => {
    await buildOrderViews({ restaurantId: 'r1', operatorId: 'op1', locale: 'fr' })
    const opCall = db.operator.findMany.mock.calls[0]![0]
    expect(opCall.select).toEqual({ id: true, name: true })
    expect(opCall.select).not.toHaveProperty('email')
    expect(opCall.select).not.toHaveProperty('phone')
  })
})
