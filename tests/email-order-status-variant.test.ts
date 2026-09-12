// tests/email-order-status-variant.test.ts — T-49 round 13, slice W6: J-C33 (H13, R-D7, ER-C20), the behaviour half.
//
// The paid-cancellation e-mail variant is chosen at SEND time. The claim-mentioning variant needs the system-claim branch at
// entry AND the lease still open at send; every other paid cancellation gets the Off variant (which names no claim).
// IMPLEMENTATION NOTE (W6) on J-C33: the route-driven fixture lives in this file because tests/email-order-status.test.ts
// mocks Prisma for the mail rail only; its source pins and webhook text guard stay in that file. ER-C20: the lease closed at
// entry but open at send (false, true) gets the Off variant, never the generic e-mail silent about the money.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { db, getToken, resolveScope, sendEmail, paidEmail, offEmail, alertMock, flag } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    claim:              { create: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    $transaction:       vi.fn(),
  },
  getToken: vi.fn(), resolveScope: vi.fn(), sendEmail: vi.fn(), paidEmail: vi.fn(), offEmail: vi.fn(), alertMock: vi.fn(), flag: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: sendEmail }))
vi.mock('@/lib/claim-emails', () => ({ sendOrderCancelledPaidEmail: paidEmail, sendOrderCancelledPaidOffEmail: offEmail }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminPaidCancellationAlert: alertMock }))
vi.mock('@/lib/refunds', () => ({ refundPayment: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: vi.fn(() => false), computeRefundSplit: vi.fn() }))
vi.mock('@/lib/claims', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isClaimsEnabled: flag }))

import { PATCH } from '@/app/api/orders/[id]/status/route'

const patch = () => PATCH(
  new NextRequest('http://x/api/orders/o1/status', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }),
  { params: { id: 'o1' } },
)

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [flag, paidEmail, offEmail, sendEmail]) m.mockReset()
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue({ ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1' })
  db.order.findUnique.mockResolvedValue({ id: 'o1', status: 'received', restaurantId: 'r1', consumerId: 'c1', paymentStatus: 'paid', total: 42.5, pointsEarned: 8, fulfillmentType: 'delivery' })
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) => Promise.resolve({ id: 'o1', status: data.status, updatedAt: new Date('2026-09-12T10:00:00Z') }))
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
afterEach(() => { vi.unstubAllEnvs() })

/** isClaimsEnabled answers `entry` at the entry read and `send` at the send read (and after). */
const lease = (entry: boolean, send: boolean) => { flag.mockReturnValueOnce(entry).mockReturnValue(send) }

describe('J-C33 — the paid-cancellation variant is chosen at send time', () => {
  const SEQUENCES: Array<[boolean, boolean, 'paid' | 'off']> = [[true, true, 'paid'], [true, false, 'off'], [false, false, 'off'], [false, true, 'off']]
  for (const [entry, send, want] of SEQUENCES) {
    it(`lease (${entry} at entry, ${send} at send) → ${want === 'paid' ? 'the claim-mentioning variant' : 'the Off variant'} only, exactly one send; the system claim follows the entry value`, async () => {
      lease(entry, send)
      const res = await patch()
      expect(res.status).toBe(200)
      expect(flag).toHaveBeenCalledTimes(2)
      expect(paidEmail).toHaveBeenCalledTimes(want === 'paid' ? 1 : 0)
      expect(offEmail).toHaveBeenCalledTimes(want === 'off' ? 1 : 0)
      expect(sendEmail).not.toHaveBeenCalled()
      // createSystemClaim gating is unchanged: the entry value decides it.
      expect(db.claim.create).toHaveBeenCalledTimes(entry ? 1 : 0)
    })
  }

  it('NEGATIVE CONTROL — the lease closing between entry and send never sends the claim-mentioning variant', async () => {
    lease(true, false)
    await patch()
    expect(paidEmail).not.toHaveBeenCalled()
    expect(offEmail).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', consumerId: 'c1' }))
  })
})
