import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    // D′ L6 (D-15) — after the earn, the route ALWAYS replays the refund prorata (lib/loyalty-prorata),
    // which reads the refund set the DATABASE proves: our Refund rows + the LedgerEntry refund lines of
    // the same PaymentIntent. Undeclared, those two reads throw into a swallowed catch: the credit
    // assertions below stayed green while « [LOYALTY MISS] earn_prorata_incomplete » was printed and an
    // admin money alert fired. Declared here so the replay runs as a REAL no-op instead of a failure.
    refund:             { findMany: vi.fn() },
    ledgerEntry:        { findMany: vi.fn(), findFirst: vi.fn() },
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

// Both loyalty failure paths of the route are SWALLOWED by design (a hiccup never blocks a delivery),
// so the only trace they leave is this log line. Capturing it here is what lets a test assert « the
// replay ran and found nothing » rather than « the replay did not write », which a crash satisfies
// just as well — and the silent [LOYALTY MISS] of the pre-L6 doubles is now an assertion, not a line a
// reader has to notice in the scrollback.
let errSpy: ReturnType<typeof vi.spyOn>

/** The marker the ops runbook greps for. No healthy delivery may print it. */
const prorataMisses = () =>
  errSpy.mock.calls.filter((c) => c.some((a) => String(a).includes('earn_prorata_incomplete')))

beforeEach(() => {
  vi.clearAllMocks()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  getTokenMock.mockResolvedValue({ sub: 'op1', role: 'restaurant' })
  // picked_up → delivered is a valid transition; the order earns 12 pts.
  // D′ L6 — `deliveredAt: null` is NOT decoration: the transition stamps that column in the same write
  // (it is the claim window's only honest anchor, spec v2 §7.1 E4), and `total` + `stripePaymentIntentId`
  // are the facts the prorata replay reads to assemble the DB-known refund set. A row missing them would
  // send the replay down a half-read path that this file is not the place to characterise.
  db.order.findUnique.mockResolvedValue({
    id: 'order1', status: 'picked_up', restaurantId: 'rest1', pointsEarned: 12, consumerId: 'op1',
    deliveredAt: null, total: 24, stripePaymentIntentId: 'pi_loyalty',
  })
  db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date(0) })
  db.operator.findUnique.mockResolvedValue({ email: 'buyer@example.com', name: 'Buyer' })
  db.loyaltyCustomer.upsert.mockResolvedValue({ id: 'lc1' })
  db.loyaltyCustomer.findUnique.mockResolvedValue({ recoveryOffsetPoints: 0 })
  db.loyaltyCustomer.update.mockResolvedValue({ id: 'lc1' })
  db.loyaltyTransaction.create.mockResolvedValue({ id: 'tx1' })
  // No refund is known of this order, from either source → the prorata has nothing to prorate.
  db.refund.findMany.mockResolvedValue([])
  db.ledgerEntry.findMany.mockResolvedValue([])
  db.ledgerEntry.findFirst.mockResolvedValue(null)
    db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]))
  db.$queryRawUnsafe.mockResolvedValue([{ recoveryOffsetPoints: 0 }])
})

afterEach(() => { errSpy.mockRestore() })

describe('PATCH delivered — earn credits even WITHOUT a pre-existing account', () => {
  it('upserts the LoyaltyCustomer at 0 pts then credits + writes the earn row', async () => {
    db.loyaltyTransaction.findFirst.mockResolvedValue(null)   // no prior 'earn', no legacy marker

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

    // D′ L6 (D-15) — TWO probes now decide whether to credit, in this order: the 'earn' idempotence row,
    // then the LEGACY pre-Phase-1 marker (a 'refund' row carrying NO sourceEventId). The rule no longer
    // skips the earn on any refund row — it credits the nominal earning and prorates it below.
    expect(db.loyaltyTransaction.findFirst).toHaveBeenCalledTimes(2)
    expect(db.loyaltyTransaction.findFirst).toHaveBeenNthCalledWith(1, {
      where: { orderId: 'order1', type: 'earn' }, select: { id: true },
    })
    expect(db.loyaltyTransaction.findFirst).toHaveBeenNthCalledWith(2, {
      where: { orderId: 'order1', type: 'refund', sourceEventId: null }, select: { id: true },
    })

    // … and the prorata replay RAN, over both sources, and wrote nothing because nothing was refunded.
    // The reads are asserted because « wrote nothing » alone is also what a crashed replay looks like.
    expect(db.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'order1', status: 'succeeded' } }),
    )
    expect(db.ledgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'refund', stripePaymentIntentId: 'pi_loyalty' } }),
    )
    expect(prorataMisses()).toEqual([])
    expect(db.loyaltyTransaction.create).toHaveBeenCalledTimes(1)   // the earn, and nothing after it
    expect(db.loyaltyCustomer.update).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — an existing earn row skips the upsert and the credit', async () => {
    db.loyaltyTransaction.findFirst.mockResolvedValue({ id: 'prior-earn' })

    const res = await deliver()
    expect(res.status).toBe(200)

    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.update).not.toHaveBeenCalled()
    expect(db.loyaltyTransaction.create).not.toHaveBeenCalled()
    // D′ L6 — BOTH probes are read before the decision (they are two independent awaits, not a
    // short-circuit), and the prorata replay still runs afterwards — it is unconditional — as a no-op.
    expect(db.loyaltyTransaction.findFirst).toHaveBeenCalledTimes(2)
    expect(db.refund.findMany).toHaveBeenCalledTimes(1)
    expect(prorataMisses()).toEqual([])
  })

  it('best-effort — a loyalty failure never blocks the delivered transition', async () => {
    db.loyaltyTransaction.findFirst.mockResolvedValue(null)
    db.loyaltyCustomer.upsert.mockRejectedValue(new Error('table missing'))

    const res = await deliver()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('delivered')
    // D′ L6 — the credit failed and said so; the prorata replay that follows it is a SEPARATE
    // best-effort step and must still have run cleanly, so the only miss logged is the earn's.
    expect(errSpy.mock.calls.some((c) => c.some((a) => String(a).includes('earn credit failed')))).toBe(true)
    expect(prorataMisses()).toEqual([])
  })

  it('no points earned → no loyalty work at all', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'order1', status: 'picked_up', restaurantId: 'rest1', pointsEarned: 0, consumerId: 'op1',
      deliveredAt: null, total: 24, stripePaymentIntentId: 'pi_loyalty',
    })

    const res = await deliver()
    expect(res.status).toBe(200)
    expect(db.loyaltyTransaction.findFirst).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
    // D′ L6 — with 0 point earned there is nothing to prorate either: the whole block, replay included,
    // is behind the same guard. Proven by the refund set never being read.
    expect(db.refund.findMany).not.toHaveBeenCalled()
    expect(db.ledgerEntry.findMany).not.toHaveBeenCalled()
  })
})
