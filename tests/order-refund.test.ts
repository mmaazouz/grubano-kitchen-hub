import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0-03 (vague 1) — POST /api/orders/[id]/refund ────────────────────────────
// Route-level spec. Q3 fondateur : the route is ADMIN GRUBANO ONLY (it used to be
// owner-scoped) — a restaurateur session is 403, no session is 401, both attempts
// AUDITED ('refund.denied'); an accepted refund is audited ('refund.run'). The A5
// mechanics are unchanged: pass-through to lib/refunds (Stripe pro-rata +
// reverse_transfer + idempotency), 409s surfaced verbatim, paymentStatus NEVER
// mutated (ledger = truth).
const { db } = vi.hoisted(() => ({
  db: {
    order:      { findUnique: vi.fn(), update: vi.fn() },
    operator:   { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

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

const ADMIN = { user: { id: 'adm1', email: 'admin@grubano.com', role: 'admin', roles: ['admin'] } }
const RESTO = { user: { id: 'op1', email: 'resto@x.com', role: 'restaurant', roles: ['restaurant'] } }

const paidOrder = {
  id: 'o1', restaurantId: 'rest1', consumerId: 'cust1',
  paymentStatus: 'paid', stripePaymentIntentId: 'pi_order_1',
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue(ADMIN)
  auditMock.mockResolvedValue(undefined)
  db.order.findUnique.mockResolvedValue(paidOrder)
  db.operator.findUnique.mockResolvedValue({ email: 'client@example.com', name: 'Client' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Resto Test' })
  refundMock.mockResolvedValue({
    ok: true, refund: { id: 're_1' }, refundedCents: 1000, remainingCents: 1500, routed: true,
  })
  emailMock.mockResolvedValue(undefined)
})

describe('POST /api/orders/[id]/refund — P0-03 admin gate + audit', () => {
  it('401 without a session — attempt audited refund.denied (unauthenticated)', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(refundMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.denied', actorId: 'anonymous',
      metadata: expect.objectContaining({ reason: 'unauthenticated' }),
    }))
  })

  it('403 for a RESTAURATEUR session (owner can no longer refund) — audited refund.denied (not_admin)', async () => {
    sessionMock.mockResolvedValue(RESTO)
    const res = await call()
    expect(res.status).toBe(403)
    expect(refundMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.denied', actorId: 'op1', targetType: 'order', targetId: 'o1',
      metadata: expect.objectContaining({ reason: 'not_admin', role: 'restaurant' }),
    }))
  })

  it('200 for an ADMIN session — accepted refund audited refund.run', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.run', actorId: 'adm1', targetType: 'order', targetId: 'o1',
      metadata: expect.objectContaining({ refundId: 're_1', refundedCents: 1000 }),
    }))
  })

  it('admin via the multi-role SET (primary role ≠ admin) is accepted', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'adm2', email: 'a2@grubano.com', role: 'restaurant', roles: ['restaurant', 'admin'] } })
    expect((await call()).status).toBe(200)
  })
})

describe('POST /api/orders/[id]/refund — guards', () => {
  it('404 when the order does not exist', async () => {
    db.order.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
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
