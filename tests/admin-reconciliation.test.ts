import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── LOT C — lib/admin-reconciliation.listCancelledPaidOrders ─────────────────────
// The « Annulées payées — remboursement à instruire » queue: cancelled orders whose
// payment WAS captured ('paid' | 'reconcile_manual'), enriched with the cents already
// given back = |Σ grossAmount| of the 'refund' ledger lines on the same PaymentIntent
// (the ledger records give-backs as NEGATIVE grossAmount; Order.paymentStatus is
// never mutated by a refund). READ-ONLY: two SELECTs, zero write, zero side-effect.

const { db } = vi.hoisted(() => ({
  db: {
    order:       { findMany: vi.fn() },
    ledgerEntry: { groupBy: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { listCancelledPaidOrders } from '@/lib/admin-reconciliation'

const row = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'o1',
  paymentStatus: 'paid',
  total: 42.5,
  createdAt: new Date('2026-08-20T10:00:00Z'),
  stripePaymentIntentId: 'pi_1',
  restaurant: { name: 'Gnocchi Bar' },
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findMany.mockResolvedValue([])
  db.ledgerEntry.groupBy.mockResolvedValue([])
})

describe('listCancelledPaidOrders — LOT C', () => {
  it('queries EXACTLY the cancelled-but-captured orders (paid | reconcile_manual), newest first, capped', async () => {
    await listCancelledPaidOrders()
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where:   { status: 'cancelled', paymentStatus: { in: ['paid', 'reconcile_manual'] } },
      orderBy: { createdAt: 'desc' },
      take:    200,
    }))
  })

  it('maps a paid cancelled order — refundedCents 0 when NO refund ledger line exists', async () => {
    db.order.findMany.mockResolvedValue([row()])
    const res = await listCancelledPaidOrders()
    expect(res.rows).toEqual([{
      id: 'o1',
      restaurantName: 'Gnocchi Bar',
      amountEuros: 42.5,
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_1',
      refundedCents: 0,
      createdAt: '2026-08-20T10:00:00.000Z',
    }])
    expect(res.capped).toBe(false)
  })

  it('refundedCents = |Σ grossAmount| of the type=refund ledger lines on the SAME PaymentIntent', async () => {
    db.order.findMany.mockResolvedValue([
      row(),
      row({ id: 'o2', stripePaymentIntentId: 'pi_2', paymentStatus: 'reconcile_manual' }),
    ])
    // Ledger stores give-backs as NEGATIVE grossAmount (recordRefundLedgerEntry).
    db.ledgerEntry.groupBy.mockResolvedValue([
      { stripePaymentIntentId: 'pi_1', _sum: { grossAmount: -1500 } },
    ])
    const res = await listCancelledPaidOrders()
    expect(db.ledgerEntry.groupBy).toHaveBeenCalledWith({
      by:    ['stripePaymentIntentId'],
      where: { type: 'refund', stripePaymentIntentId: { in: ['pi_1', 'pi_2'] } },
      _sum:  { grossAmount: true },
    })
    expect(res.rows[0]).toMatchObject({ id: 'o1', refundedCents: 1500 })
    expect(res.rows[1]).toMatchObject({ id: 'o2', paymentStatus: 'reconcile_manual', refundedCents: 0 })
  })

  it('order WITHOUT a PaymentIntent → refundedCents 0, PI null, and NO ledger query for it', async () => {
    db.order.findMany.mockResolvedValue([row({ id: 'o3', stripePaymentIntentId: null })])
    const res = await listCancelledPaidOrders()
    expect(db.ledgerEntry.groupBy).not.toHaveBeenCalled() // no PI at all → no grouped query
    expect(res.rows[0]).toMatchObject({ id: 'o3', stripePaymentIntentId: null, refundedCents: 0 })
  })

  it('missing restaurant relation → restaurantName null (renders « inconnu » in the page)', async () => {
    db.order.findMany.mockResolvedValue([row({ restaurant: null })])
    const res = await listCancelledPaidOrders()
    expect(res.rows[0].restaurantName).toBeNull()
  })

  it('capped:true at the 200-row cap', async () => {
    db.order.findMany.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => row({ id: `o${i}`, stripePaymentIntentId: `pi_${i}` })),
    )
    const res = await listCancelledPaidOrders()
    expect(res.capped).toBe(true)
    expect(res.rows).toHaveLength(200)
  })
})
