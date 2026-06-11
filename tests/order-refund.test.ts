import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── C3-fix — POST /api/orders/[id]/refund (the A5×C1 gap) ─────────────────────
// Route-level spec, A5 pattern: owner-scope guards, paid-only, pass-through to
// lib/refunds (which owns the Stripe pro-rata + reverse_transfer + idempotency),
// 409s surfaced verbatim, paymentStatus NEVER mutated (ledger = truth).
const { db } = vi.hoisted(() => ({
  db: {
    order:      { findUnique: vi.fn(), update: vi.fn() },
    operator:   { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

const { refundMock } = vi.hoisted(() => ({ refundMock: vi.fn() }))
vi.mock('@/lib/refunds', () => ({ refundPayment: refundMock }))

const { emailMock } = vi.hoisted(() => ({ emailMock: vi.fn() }))
vi.mock('@/lib/transactional-emails', () => ({ sendRefundConfirmation: emailMock }))

import { POST } from '@/app/api/orders/[id]/refund/route'

const makeReq = (body?: Record<string, unknown>) =>
  new Request('https://app.grubano.com/api/orders/o1/refund', {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  })
const call = (body?: Record<string, unknown>) => POST(makeReq(body), { params: { id: 'o1' } })

const paidOrder = {
  id: 'o1', restaurantId: 'rest1', consumerId: 'cust1',
  paymentStatus: 'paid', stripePaymentIntentId: 'pi_order_1',
}

beforeEach(() => {
  vi.clearAllMocks()
  scopeMock.mockResolvedValue({ ok: true, ownedIds: ['rest1'] })
  db.order.findUnique.mockResolvedValue(paidOrder)
  db.operator.findUnique.mockResolvedValue({ email: 'client@example.com', name: 'Client' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Resto Test' })
  refundMock.mockResolvedValue({
    ok: true, refund: { id: 're_1' }, refundedCents: 1000, remainingCents: 1500, routed: true,
  })
  emailMock.mockResolvedValue(undefined)
})

describe('POST /api/orders/[id]/refund — guards', () => {
  it('404 when the order does not exist', async () => {
    db.order.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(refundMock).not.toHaveBeenCalled()
  })

  it("403 when the order belongs to another restaurateur", async () => {
    scopeMock.mockResolvedValue({ ok: true, ownedIds: ['otherResto'] })
    expect((await call()).status).toBe(403)
    expect(refundMock).not.toHaveBeenCalled()
  })

  it('409 when the order is not paid (nothing to refund)', async () => {
    db.order.findUnique.mockResolvedValue({ ...paidOrder, paymentStatus: 'pending' })
    expect((await call()).status).toBe(409)
    expect(refundMock).not.toHaveBeenCalled()
  })

  it('400 on an invalid amount', async () => {
    expect((await call({ amountCents: -5 })).status).toBe(400)
    expect(refundMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/orders/[id]/refund — pass-through to lib/refunds (A5 mechanics)', () => {
  it('full refund: omitted amount is passed through as undefined (lib refunds the remainder)', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(refundMock).toHaveBeenCalledWith({ paymentIntentId: 'pi_order_1', amountCents: undefined })
    expect(await res.json()).toMatchObject({
      refundId: 're_1', refundedCents: 1000, remainingCents: 1500, routed: true,
    })
  })

  it('partial refund: amountCents is passed through verbatim', async () => {
    await call({ amountCents: 750 })
    expect(refundMock).toHaveBeenCalledWith({ paymentIntentId: 'pi_order_1', amountCents: 750 })
  })

  it('surfaces lib/refunds 409 verbatim (already fully refunded / over-amount)', async () => {
    refundMock.mockResolvedValue({ ok: false, status: 409, error: 'Paiement déjà intégralement remboursé.' })
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch('intégralement')
  })

  it('NEVER mutates paymentStatus (the ledger is the truth of give-backs)', async () => {
    await call()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('sends the customer email best-effort and never fails the refund on email error', async () => {
    emailMock.mockRejectedValue(new Error('smtp down'))
    const res = await call()
    expect(res.status).toBe(200) // refund succeeded despite the email failure
  })
})
