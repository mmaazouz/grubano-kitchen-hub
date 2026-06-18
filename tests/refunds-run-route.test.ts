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

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

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
