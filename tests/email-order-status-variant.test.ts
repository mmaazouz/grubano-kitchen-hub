// tests/email-order-status-variant.test.ts — T-49 round 13, slice W6: J-C33 (H13, R-D7, ER-C20), the behaviour half —
// amended by D′ L1 (spec v2 §3.2, §6.2).
//
// The paid-cancellation e-mail variant is chosen at SEND time. The claim-mentioning variant needs the system-claim branch at
// entry (`claimsOn = claimsSurfaceOpen()`) AND the pre-money gate still open at send (`claimsOpenNow =
// claimNoticeGate('pre_money')`); every other paid cancellation gets the Off variant (which names no claim).
// IMPLEMENTATION NOTE (W6) on J-C33: the route-driven fixture lives in this file because tests/email-order-status.test.ts
// mocks Prisma for the mail rail only; its source pins and webhook text guard stay in that file. ER-C20: the gate closed at
// entry but open at send (false, true) gets the Off variant, never the generic e-mail silent about the money.
// D′ L1: the route reads lib/claim-flags, which reads process.env at each site — NO gate is mocked here. The gate is opened
// THE REAL WAY (the legacy lease of tests/support/claims-window, or the product SURFACE flag) and flipped BETWEEN the two
// reads from inside the order.update mock, which the route calls after the entry read and before the send read: the ER-C20
// scenario (a lease closing — or opening — mid-request) is played on the real environment, with a witness of both reads.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

const { db, getToken, resolveScope, sendEmail, paidEmail, offEmail, alertMock } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    claim:              { create: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    $transaction:       vi.fn(),
  },
  getToken: vi.fn(), resolveScope: vi.fn(), sendEmail: vi.fn(), paidEmail: vi.fn(), offEmail: vi.fn(), alertMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: sendEmail }))
vi.mock('@/lib/claim-emails', () => ({ sendOrderCancelledPaidEmail: paidEmail, sendOrderCancelledPaidOffEmail: offEmail }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminPaidCancellationAlert: alertMock }))
vi.mock('@/lib/refunds', () => ({ refundPayment: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: vi.fn(() => false), computeRefundSplit: vi.fn() }))

import { PATCH } from '@/app/api/orders/[id]/status/route'
import { claimsSurfaceOpen, claimNoticeGate } from '@/lib/claim-flags'

const patch = () => PATCH(
  new NextRequest('http://x/api/orders/o1/status', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }),
  { params: { id: 'o1' } },
)

/** The kill-switch: no product flag, no lease — every gate reads CLOSED. */
const killSwitch = () => { closeClaimsWindow(); delete process.env.CLAIMS_SURFACE_ENABLED; delete process.env.CLAIMS_INTAKE_ENABLED }
type Shape = 'legacy lease' | 'product surface'
const SHAPES: Shape[] = ['legacy lease', 'product surface']
/** Open (or close) the gate the real way, in the requested shape. */
const setGate = (shape: Shape, open: boolean) => {
  killSwitch()
  if (!open) return
  if (shape === 'legacy lease') openClaimsWindow()
  else process.env.CLAIMS_SURFACE_ENABLED = 'true'
}
const updated = (status: string) => ({ id: 'o1', status, updatedAt: new Date('2026-09-12T10:00:00Z') })

/** What the two gate reads could see: recorded around the flip, which happens inside order.update (between the reads). */
const witness = { surfaceBeforeFlip: null as boolean | null, preMoneyAfterFlip: null as boolean | null, flips: 0 }
/** The gate answers `entry` at the entry read and `send` at the send read (and after). */
const gate = (shape: Shape, entry: boolean, send: boolean) => {
  setGate(shape, entry)
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) => {
    witness.surfaceBeforeFlip = claimsSurfaceOpen()
    setGate(shape, send)
    witness.preMoneyAfterFlip = claimNoticeGate('pre_money')
    witness.flips++
    return Promise.resolve(updated(data.status))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [paidEmail, offEmail, sendEmail, db.order.update, db.restaurant.findUnique]) m.mockReset()
  killSwitch()
  witness.surfaceBeforeFlip = null; witness.preMoneyAfterFlip = null; witness.flips = 0
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue({ ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1' })
  db.order.findUnique.mockResolvedValue({ id: 'o1', status: 'received', restaurantId: 'r1', consumerId: 'c1', paymentStatus: 'paid', total: 42.5, pointsEarned: 8, fulfillmentType: 'delivery' })
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) => Promise.resolve(updated(data.status)))
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
  db.claim.create.mockResolvedValue({ id: 'clsys1' })
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: typeof db) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[])))
  sendEmail.mockResolvedValue({ status: 'sent' })
  paidEmail.mockResolvedValue({ status: 'sent' })
  offEmail.mockResolvedValue({ status: 'sent' })
  alertMock.mockResolvedValue({ status: 'sent' })
})
afterEach(() => { vi.unstubAllEnvs(); killSwitch() })

describe('J-C33 (D′ L1) — the paid-cancellation variant is chosen at send time, on the real gates', () => {
  const SEQUENCES: Array<[boolean, boolean, 'paid' | 'off']> = [[true, true, 'paid'], [true, false, 'off'], [false, false, 'off'], [false, true, 'off']]
  for (const shape of SHAPES) {
    for (const [entry, send, want] of SEQUENCES) {
      it(`${shape} (${entry} at entry, ${send} at send) → ${want === 'paid' ? 'the claim-mentioning variant' : 'the Off variant'} only, exactly one send; the system claim follows the entry value`, async () => {
        gate(shape, entry, send)
        const res = await patch()
        expect(res.status).toBe(200)
        // the flip happened exactly once, between the reads: the surface read `entry` before it, the pre-money gate reads `send` after it
        expect(witness).toEqual({ surfaceBeforeFlip: entry, preMoneyAfterFlip: send, flips: 1 })
        expect(paidEmail).toHaveBeenCalledTimes(want === 'paid' ? 1 : 0)
        expect(offEmail).toHaveBeenCalledTimes(want === 'off' ? 1 : 0)
        expect(sendEmail).not.toHaveBeenCalled()
        // createSystemClaim gating is unchanged: the entry value (the SURFACE) decides it.
        expect(db.claim.create).toHaveBeenCalledTimes(entry ? 1 : 0)
      })
    }
  }

  it('S-13 / §3.2 — the SURFACE decides the system claim, never the intake: SURFACE=true · INTAKE=false → the claim-mentioning variant and the system claim; INTAKE=true alone → the Off variant and no claim', async () => {
    killSwitch(); process.env.CLAIMS_SURFACE_ENABLED = 'true'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    expect((await patch()).status).toBe(200)
    expect(paidEmail).toHaveBeenCalledTimes(1)
    expect(offEmail).not.toHaveBeenCalled()
    expect(db.claim.create).toHaveBeenCalledTimes(1)

    vi.clearAllMocks(); for (const m of [paidEmail, offEmail]) m.mockReset()
    paidEmail.mockResolvedValue({ status: 'sent' }); offEmail.mockResolvedValue({ status: 'sent' })
    killSwitch(); process.env.CLAIMS_INTAKE_ENABLED = 'true'
    expect(claimsSurfaceOpen()).toBe(false)
    expect((await patch()).status).toBe(200)
    expect(paidEmail).not.toHaveBeenCalled()
    expect(offEmail).toHaveBeenCalledTimes(1)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — the gate closing between entry and send never sends the claim-mentioning variant (both shapes)', async () => {
    for (const shape of SHAPES) {
      paidEmail.mockClear(); offEmail.mockClear()
      gate(shape, true, false)
      await patch()
      expect(paidEmail, shape).not.toHaveBeenCalled()
      expect(offEmail, shape).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', consumerId: 'c1' }))
    }
  })

  it('NEGATIVE CONTROL — a gate closing AFTER the send read (inside the admin-alert block’s restaurant read) leaves the claim-mentioning variant: the read is at send time, nothing later re-reads it', async () => {
    setGate('legacy lease', true)
    // the route reads the restaurant twice: once beside the recipient (BEFORE the send read), once for the admin alert (AFTER it)
    db.restaurant.findUnique.mockResolvedValueOnce({ name: 'Gnocchi Bar' }).mockImplementation(async () => { killSwitch(); return { name: 'Gnocchi Bar' } })
    const res = await patch()
    expect(res.status).toBe(200)
    expect(db.restaurant.findUnique).toHaveBeenCalledTimes(2)
    expect(claimsSurfaceOpen()).toBe(false) // the flip did happen — after the send read
    expect(paidEmail).toHaveBeenCalledTimes(1)
    expect(offEmail).not.toHaveBeenCalled()
    expect(alertMock).toHaveBeenCalledTimes(1)
  })
})
