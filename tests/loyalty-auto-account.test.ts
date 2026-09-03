import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Chantier fidélité — loyalty is an AUTOMATIC acquis ─────────────────────────
// Root cause of "0 point à vie": the normal consumer signup created NO
// LoyaltyCustomer, and the earn path only did findUnique-then-if(lc) → the
// credit was silently skipped for everyone without an explicit opt-in account.
// The earn path now UPSERTs the account by email (at 0 pts — never the welcome
// bonus) and credits + writes the 'earn' ledger row, idempotently per order.
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() , findUnique: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    $transaction:       vi.fn(),
    $queryRawUnsafe:     vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

// The PATCH route now resolves establishment ownership (hardening). Mock the
// helper so the caller owns 'rest1' (the order's restaurant) → the ownership
// pre-condition passes and the loyalty earn-path assertions run unchanged.
vi.mock('@/lib/establishment-scope', () => ({
  resolveEstablishmentScope: vi.fn().mockResolvedValue({
    ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['rest1'], restaurantId: 'rest1',
  }),
}))

import { PATCH as patchStatus } from '@/app/api/orders/[id]/status/route'

const statusReq = (status: string) =>
  new NextRequest('https://app.grubano.com/api/orders/order1/status', {
    method:  'PATCH',
    body:    JSON.stringify({ status }),
    headers: { 'content-type': 'application/json' },
  })

const deliver = () => patchStatus(statusReq('delivered'), { params: { id: 'order1' } })

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'op1', role: 'restaurant' })
  // picked_up → delivered is a valid transition; the order earns 12 pts.
  db.order.findUnique.mockResolvedValue({ id: 'order1', status: 'picked_up', restaurantId: 'rest1', pointsEarned: 12, consumerId: 'op1' })
  db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date(0) })
  db.operator.findUnique.mockResolvedValue({ email: 'buyer@example.com', name: 'Buyer' })
  db.loyaltyCustomer.upsert.mockResolvedValue({ id: 'lc1' })
  db.loyaltyCustomer.findUnique.mockResolvedValue({ recoveryOffsetPoints: 0 })
  db.loyaltyCustomer.update.mockResolvedValue({ id: 'lc1' })
  db.loyaltyTransaction.create.mockResolvedValue({ id: 'tx1' })
    db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]))
  db.$queryRawUnsafe.mockResolvedValue([{ recoveryOffsetPoints: 0 }])
})

describe('PATCH delivered — earn credits even WITHOUT a pre-existing account', () => {
  it('upserts the LoyaltyCustomer at 0 pts then credits + writes the earn row', async () => {
    db.loyaltyTransaction.findFirst.mockResolvedValue(null)   // no prior 'earn'

    const res = await deliver()
    expect(res.status).toBe(200)

    // Account ensured by email — created at 0 (NOT the 10-pt welcome bonus).
    expect(db.loyaltyCustomer.upsert).toHaveBeenCalledTimes(1)
    const upsertArg = db.loyaltyCustomer.upsert.mock.calls[0][0] as any
    expect(upsertArg.where).toEqual({ email: 'buyer@example.com' })
    expect(upsertArg.create.pointsBalance).toBe(0)
    expect(upsertArg.create.email).toBe('buyer@example.com')

    // Balance credited by exactly pointsEarned, and a signed 'earn' row written.
    expect(db.loyaltyCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lc1' }, data: expect.objectContaining({ pointsBalance: { increment: 12 } }) }),
    )
    expect(db.loyaltyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: 'lc1', orderId: 'order1', type: 'earn', points: 12 }) }),
    )
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — an existing earn row skips the upsert and the credit', async () => {
    db.loyaltyTransaction.findFirst.mockResolvedValue({ id: 'prior-earn' })

    const res = await deliver()
    expect(res.status).toBe(200)

    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.update).not.toHaveBeenCalled()
    expect(db.loyaltyTransaction.create).not.toHaveBeenCalled()
  })

  it('best-effort — a loyalty failure never blocks the delivered transition', async () => {
    db.loyaltyTransaction.findFirst.mockResolvedValue(null)
    db.loyaltyCustomer.upsert.mockRejectedValue(new Error('table missing'))

    const res = await deliver()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('delivered')
  })

  it('no points earned → no loyalty work at all', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'order1', status: 'picked_up', restaurantId: 'rest1', pointsEarned: 0, consumerId: 'op1' })

    const res = await deliver()
    expect(res.status).toBe(200)
    expect(db.loyaltyTransaction.findFirst).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
  })
})
