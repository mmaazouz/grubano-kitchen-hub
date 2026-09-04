import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0-03 + P0-26 (vague 1) + PHASE 2 (D-A) — POST /api/orders/[id]/refund ─────────
// Route-level spec. Q3 fondateur : the route is ADMIN GRUBANO ONLY (it used to be
// owner-scoped) — a restaurateur session is 403, no session is 401, both attempts
// AUDITED ('refund.denied'); an accepted refund is audited ('refund.run').
// P0-26 : même régime que /api/admin/refunds/run — rate-limit → kill-switch
// REFUNDS_ENABLED (défaut OFF → 403 « Remboursements indisponibles », AVANT toute
// auth/DB/Stripe) → garde admin.
// PHASE 2 (REFUND-FINANCIAL-CONTRACT §4, decision D-A): the mechanics are now the
// royalty-aware ENGINE lib/refund.executeRefund — ONE engine on the order path. The
// old pass-through to lib/refunds (royalty-UNAWARE → franchise double-return) is GONE;
// the public response shape is preserved (refundId = re_…, refundedCents,
// remainingCents, routed). Status truth (§8): a Stripe-`pending` refund → 202
// {status:'pending'}, audited pending:true, NO « effectué » email.
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

// PHASE 2 — the engine is the ONLY refund mechanics on this route. lib/refunds (the
// PI-keyed, royalty-unaware lib for tickets/deposits) must NEVER be reached from here:
// it is mocked with a spy that the negative control asserts is never called.
const { engineMock, flagMock, limitMock, legacyRefundMock } = vi.hoisted(() => ({
  engineMock: vi.fn(), flagMock: vi.fn(), limitMock: vi.fn(), legacyRefundMock: vi.fn(),
}))
vi.mock('@/lib/refund', () => ({ isRefundsEnabled: flagMock, executeRefund: engineMock }))
vi.mock('@/lib/refunds', () => ({ refundPayment: legacyRefundMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: limitMock }))

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
const OK_OUTCOME = {
  ok: true, resumed: false, refundId: 'rf1', stripeRefundId: 're_1', amountCents: 1000,
  restaurantReverseCents: 880, applicationFeeRefundCents: 120, royaltyRefundCents: 0, royaltyClawbackCents: 0,
  cumulativeRefundedCents: 1000, remainingRefundableCents: 1500, routed: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockReturnValue(true)   // REFUNDS_ENABLED ON (réglage bêta) pour les tests de passage
  limitMock.mockReturnValue(null)  // non limité par défaut
  sessionMock.mockResolvedValue(ADMIN)
  auditMock.mockResolvedValue(undefined)
  db.order.findUnique.mockResolvedValue(paidOrder)
  db.operator.findUnique.mockResolvedValue({ email: 'client@example.com', name: 'Client' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Resto Test' })
  engineMock.mockResolvedValue(OK_OUTCOME)
  emailMock.mockResolvedValue(undefined)
})

describe('POST /api/orders/[id]/refund — P0-26 kill-switch + rate-limit (régime refunds/run)', () => {
  it('⭐ REFUNDS_ENABLED OFF → 403 « Remboursements indisponibles » AVANT auth/DB/Stripe', async () => {
    flagMock.mockReturnValue(false)
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Remboursements indisponibles', gated: true })
    expect(engineMock).not.toHaveBeenCalled()
    expect(sessionMock).not.toHaveBeenCalled()      // gate AVANT la garde admin
    expect(db.order.findUnique).not.toHaveBeenCalled()
  })

  it('rate-limit : la réponse du limiteur est renvoyée telle quelle, rien ne s\'exécute', async () => {
    const tooMany = new Response(JSON.stringify({ error: 'Trop de requêtes' }), { status: 429 })
    limitMock.mockReturnValue(tooMany)
    const res = await call()
    expect(res.status).toBe(429)
    expect(limitMock).toHaveBeenCalledWith(expect.anything(), 'order_refund', { limitDefault: 20, windowDefault: 60 })
    expect(flagMock).not.toHaveBeenCalled()
    expect(engineMock).not.toHaveBeenCalled()
  })

  it('flag ON + admin → accès normal conservé (200)', async () => {
    expect((await call()).status).toBe(200)
  })
})

describe('POST /api/orders/[id]/refund — P0-03 admin gate + audit', () => {
  it('401 without a session — attempt audited refund.denied (unauthenticated)', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(engineMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.denied', actorId: 'anonymous',
      metadata: expect.objectContaining({ reason: 'unauthenticated' }),
    }))
  })

  it('403 for a RESTAURATEUR session (owner can no longer refund) — audited refund.denied (not_admin)', async () => {
    sessionMock.mockResolvedValue(RESTO)
    const res = await call()
    expect(res.status).toBe(403)
    expect(engineMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.denied', actorId: 'op1', targetType: 'order', targetId: 'o1',
      metadata: expect.objectContaining({ reason: 'not_admin', role: 'restaurant' }),
    }))
  })

  it('200 for an ADMIN session — accepted refund audited refund.run (Stripe re_ id + engine row)', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.run', actorId: 'adm1', targetType: 'order', targetId: 'o1',
      metadata: expect.objectContaining({ refundId: 're_1', refundRow: 'rf1', refundedCents: 1000, remainingCents: 1500 }),
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
    expect(engineMock).not.toHaveBeenCalled()
  })

  it('409 when the order is not paid (nothing to refund)', async () => {
    db.order.findUnique.mockResolvedValue({ ...paidOrder, paymentStatus: 'pending' })
    expect((await call()).status).toBe(409)
    expect(engineMock).not.toHaveBeenCalled()
  })

  // LOT C — garde ÉLARGIE (miroir executeRefund) : 'reconcile_manual' (ghost order
  // encaissé, file manuelle) est de l'argent encaissé — la route admin l'accepte.
  it('[LOT C] 200 pour une commande reconcile_manual — la file manuelle est remboursable', async () => {
    db.order.findUnique.mockResolvedValue({ ...paidOrder, paymentStatus: 'reconcile_manual' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(engineMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: undefined, reason: 'admin:orders/[id]/refund' })
  })

  it('[LOT C] la garde élargie refuse toujours un paymentStatus null (jamais encaissé) → 409', async () => {
    db.order.findUnique.mockResolvedValue({ ...paidOrder, paymentStatus: null })
    expect((await call()).status).toBe(409)
    expect(engineMock).not.toHaveBeenCalled()
  })

  it('400 on an invalid amount', async () => {
    expect((await call({ amountCents: -5 })).status).toBe(400)
    expect(engineMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/orders/[id]/refund — PHASE 2 D-A: ONE engine on the order path (lib/refund.executeRefund)', () => {
  it('full refund: omitted amount → engine refunds the remainder; public shape preserved (refundId = re_…)', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(engineMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: undefined, reason: 'admin:orders/[id]/refund' })
    expect(await res.json()).toMatchObject({
      refundId: 're_1', refundedCents: 1000, remainingCents: 1500, routed: true,
    })
  })

  it('partial refund: amountCents is passed to the engine verbatim (keyed by orderId, never by PI)', async () => {
    await call({ amountCents: 750 })
    expect(engineMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 750, reason: 'admin:orders/[id]/refund' })
  })

  it('⭐ [negative control of the P0] the royalty-UNAWARE lib/refunds.refundPayment is NEVER called from the order path', async () => {
    await call()
    await call({ amountCents: 300 })
    expect(legacyRefundMock).not.toHaveBeenCalled()
    expect(engineMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces the engine 409 verbatim (already fully refunded / over-amount / fail-closed lock)', async () => {
    engineMock.mockResolvedValue({ ok: false, status: 409, error: 'Paiement déjà intégralement remboursé.' })
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch('intégralement')
    expect(emailMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'refund.run' }))
  })

  it('RESUME-FIRST: an interrupted refund re-driven instead of the requested amount → response SAYS so (resumedIgnoredAmount) + audited', async () => {
    engineMock.mockResolvedValue({ ...OK_OUTCOME, resumed: true, resumedIgnoredAmount: true, amountCents: 2500, remainingRefundableCents: 0 })
    const res = await call({ amountCents: 300 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ resumed: true, resumedIgnoredAmount: true, refundedCents: 2500, remainingCents: 0 })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.run', metadata: expect.objectContaining({ resumed: true, resumedIgnoredAmount: true, requestedCents: 300 }),
    }))
  })

  it('NEVER mutates paymentStatus (the ledger is the truth of give-backs)', async () => {
    await call()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('sends the customer email best-effort (Stripe succeeded only) and never fails the refund on email error', async () => {
    emailMock.mockRejectedValue(new Error('smtp down'))
    const res = await call()
    expect(res.status).toBe(200) // refund succeeded despite the email failure
    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({ refundedCents: 1000, partial: true, dedupeKey: 'order:o1:1000' }))
  })
})

describe('POST /api/orders/[id]/refund — PHASE 2 §8 status truth (pending variant)', () => {
  const PENDING = {
    ok: false, status: 202, pending: true, refundId: 'rf1', stripeRefundId: 're_p', amountCents: 1000, stripeStatus: 'pending',
    error: 'Remboursement en attente côté Stripe — aucun montant n’a encore été restitué au client.',
  }

  it('Stripe-pending refund → 202 {status:"pending"}, NO error key, NO « effectué » email', async () => {
    engineMock.mockResolvedValue(PENDING)
    const res = await call()
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'pending', refundId: 're_p', refundRow: 'rf1', refundedCents: 1000 })
    expect(body.error).toBeUndefined()
    expect(emailMock).not.toHaveBeenCalled()
  })

  it('[§15 A4] the pending refund IS audited (an admin created a live Stripe refund) with pending:true', async () => {
    engineMock.mockResolvedValue(PENDING)
    await call()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.run', actorId: 'adm1', targetId: 'o1',
      metadata: expect.objectContaining({ pending: true, refundId: 're_p', refundRow: 'rf1', stripeStatus: 'pending' }),
    }))
  })

  it('[negative control] asserting the old « 200 + email » on a pending refund FAILS', async () => {
    engineMock.mockResolvedValue(PENDING)
    const res = await call()
    expect(res.status).not.toBe(200)
    expect(emailMock).not.toHaveBeenCalled()
  })
})
