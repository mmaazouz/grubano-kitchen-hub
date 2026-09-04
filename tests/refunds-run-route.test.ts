import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.5-A — POST /api/admin/refunds/run ─────────────────────────────────────────
// Gate order: kill-switch (403 gated) BEFORE auth; then cron-secret OR admin session
// (401/403). No refund work runs until both pass. Body validation. Pass-through of the
// engine outcome (incl. error statuses).

const { flagMock, execMock } = vi.hoisted(() => ({ flagMock: vi.fn(), execMock: vi.fn() }))
vi.mock('@/lib/refund', () => ({ isRefundsEnabled: flagMock, executeRefund: execMock }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    // LOT C — the post-success customer-email block loads the order + resto.
    order:      { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

// LOT C — customer confirmation email, best-effort after a successful refund.
const { emailMock } = vi.hoisted(() => ({ emailMock: vi.fn() }))
vi.mock('@/lib/transactional-emails', () => ({ sendRefundConfirmation: emailMock }))

import { POST } from '@/app/api/admin/refunds/run/route'

function post(opts: { token?: string; body?: unknown } = {}) {
  return POST(new Request('https://app.grubano.com/api/admin/refunds/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-internal-token': opts.token } : {}) },
    body: JSON.stringify(opts.body ?? { orderId: 'o1' }),
  }))
}

const okResult = {
  ok: true, resumed: false, refundId: 'rf1', stripeRefundId: 're_1', amountCents: 2500,
  restaurantReverseCents: 2050, applicationFeeRefundCents: 450, royaltyRefundCents: 150,
  royaltyClawbackCents: 0, cumulativeRefundedCents: 2500, remainingRefundableCents: 2500, routed: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockReturnValue(true)
  execMock.mockResolvedValue(okResult)
  // LOT C — email-context lookups: no order/consumer by default → email skipped
  // cleanly (the pre-existing tests are unaffected by the additive email block).
  db.order.findUnique.mockResolvedValue(null)
  db.restaurant.findUnique.mockResolvedValue(null)
  emailMock.mockResolvedValue(undefined)
  process.env.INTERNAL_CRON_TOKEN = 'secret-cron'
})
afterEach(() => { delete process.env.INTERNAL_CRON_TOKEN })

describe('POST /api/admin/refunds/run — gate + auth', () => {
  it('(h) flag OFF → 403 gated, BEFORE auth/processing', async () => {
    flagMock.mockReturnValue(false)
    const res = await post()
    expect(res.status).toBe(403)
    expect((await res.json()).gated).toBe(true)
    expect(execMock).not.toHaveBeenCalled()
    expect(sessionMock).not.toHaveBeenCalled()    // gate is before auth
  })

  it('flag ON + no token + no session → 401, no refund', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(401)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('flag ON + wrong token + non-admin session → 403, no refund', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'resto@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'restaurant' })
    const res = await post({ token: 'nope' })
    expect(res.status).toBe(403)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('cron token → runs (no session needed)', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(200)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: undefined, reason: undefined })
  })

  it('admin session → runs', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'admin@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    const res = await post()
    expect(res.status).toBe(200)
    expect(execMock).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/admin/refunds/run — body + pass-through', () => {
  it('400 when orderId is missing', async () => {
    const res = await post({ token: 'secret-cron', body: { amountCents: 100 } })
    expect(res.status).toBe(400)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('partial refund: amountCents + reason forwarded; full split echoed', async () => {
    const res = await post({ token: 'secret-cron', body: { orderId: 'o9', amountCents: 2500, reason: 'geste' } })
    expect(res.status).toBe(200)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o9', amountCents: 2500, reason: 'geste' })
    expect(await res.json()).toMatchObject({ ok: true, amountCents: 2500, royaltyRefundCents: 150, restaurantReverseCents: 2050 })
  })

  it('engine error status is surfaced verbatim (e.g. 409 cumul)', async () => {
    execMock.mockResolvedValue({ ok: false, status: 409, error: 'Un remboursement est déjà en cours sur ce montant cumulé.' })
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch('déjà en cours')
  })
})

// ── LOT C — customer email after a successful engine refund (best-effort) ─────────
// Asymmetry closed: POST /api/orders/[id]/refund already confirmed to the customer,
// this route (the royalty-aware engine) sent NOTHING. Same pattern, same dedupeKey
// `order:<id>:<cents of THIS refund>` — a resume re-driving the same amount lands
// on the same key (duplicate), never two emails for one money movement.
describe('POST /api/admin/refunds/run — LOT C email client best-effort', () => {
  const withEmailContext = () => {
    db.order.findUnique.mockResolvedValue({ consumerId: 'c1', restaurantId: 'r1' })
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
  }

  it('refund OK → sendRefundConfirmation part (pattern orders/[id]/refund : dedupeKey order:<id>:<cents>)', async () => {
    withEmailContext()
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(200)
    expect(emailMock).toHaveBeenCalledTimes(1)
    expect(emailMock).toHaveBeenCalledWith({
      to:             'lea@x.fr',
      customerName:   'Léa',
      restaurantName: 'Gnocchi Bar',
      refundedCents:  2500,
      partial:        true,               // remainingRefundableCents 2500 > 0
      dedupeKey:      'order:o1:2500',
    })
  })

  it('échec de l\'email → JAMAIS bloquant : le refund reste un 200 complet', async () => {
    withEmailContext()
    emailMock.mockRejectedValue(new Error('smtp down'))
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('échec du MOTEUR → aucun email (rien à confirmer)', async () => {
    withEmailContext()
    execMock.mockResolvedValue({ ok: false, status: 409, error: 'Paiement déjà intégralement remboursé.' })
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(409)
    expect(emailMock).not.toHaveBeenCalled()
  })

  it('consommateur sans email → skip propre, toujours 200', async () => {
    db.order.findUnique.mockResolvedValue({ consumerId: 'c1', restaurantId: 'r1' })
    db.operator.findUnique.mockResolvedValue({ email: null, name: 'Léa' })
    db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(200)
    expect(emailMock).not.toHaveBeenCalled()
  })

  it('remboursement TOTAL (remaining 0) → partial:false', async () => {
    withEmailContext()
    execMock.mockResolvedValue({ ...okResult, amountCents: 5000, remainingRefundableCents: 0 })
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(200)
    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({
      refundedCents: 5000, partial: false, dedupeKey: 'order:o1:5000',
    }))
  })
})

// ── PHASE 2 §8 / §15 A4 — status truth on the admin engine route ─────────────────────
describe('POST /api/admin/refunds/run — PHASE 2 pending variant (Stripe refund not yet succeeded)', () => {
  const PENDING = {
    ok: false, status: 202, pending: true, refundId: 'rf1', stripeRefundId: 're_p', amountCents: 2500, stripeStatus: 'pending',
    error: 'Remboursement en attente côté Stripe — aucun montant n’a encore été restitué au client.',
  }
  it('pending → 202 {status:"pending"}, audited refund.run with pending:true, NO « effectué » email', async () => {
    execMock.mockResolvedValue(PENDING)
    db.order.findUnique.mockResolvedValue({ consumerId: 'c1', restaurantId: 'r1' })
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, status: 'pending', refundId: 'rf1', stripeRefundId: 're_p', amountCents: 2500 })
    expect(body.error).toBeUndefined()
    expect(emailMock).not.toHaveBeenCalled()
  })
  it('[negative control] the old « 200 + email » on a pending refund FAILS', async () => {
    execMock.mockResolvedValue(PENDING)
    const res = await post({ token: 'secret-cron' })
    expect(res.status).not.toBe(200)
  })
})
