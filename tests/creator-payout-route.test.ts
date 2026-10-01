import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.3 — POST /api/admin/creator-payouts/run (Agent 39) ────────────────────
// Gate order: kill-switch (403 gated) BEFORE auth; then cron-secret OR admin
// session (401/403). No payout work runs until both pass. No IDOR (a non-admin
// session is rejected; only a cron token or admin may trigger).

const { flagMock, payMock, runMock } = vi.hoisted(() => ({ flagMock: vi.fn(), payMock: vi.fn(), runMock: vi.fn() }))
vi.mock('@/lib/creator-payout', () => ({
  isCreatorPayoutEnabled: flagMock,
  payCreator: payMock,
  runCreatorPayouts: runMock,
}))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/admin/creator-payouts/run/route'

// P0-06 — rôle créateur ouvert pour ces tests (la surface est derrière CREATOR_ENABLED,
// 404 OFF prouvé par tests/role-locks.test.ts) ; ici on teste la logique métier.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

function post(opts: { token?: string; body?: unknown } = {}) {
  return POST(new Request('https://app.grubano.com/api/admin/creator-payouts/run', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { 'x-internal-token': opts.token } : {}),
    },
    body: JSON.stringify(opts.body ?? {}),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockReturnValue(true)
  runMock.mockResolvedValue({ processed: 0, paid: 0, skipped: 0, failed: 0, results: [] })
  payMock.mockResolvedValue({ status: 'paid', creatorId: 'c1', amountCents: 5000, stripeTransferId: 'tr_1', resumed: false })
  process.env.INTERNAL_CRON_TOKEN = 'secret-cron'
})
afterEach(() => { delete process.env.INTERNAL_CRON_TOKEN })

describe('POST /api/admin/creator-payouts/run', () => {
  it('(e) flag OFF → 403 gated, BEFORE auth/processing', async () => {
    flagMock.mockReturnValue(false)
    const res = await post()
    expect(res.status).toBe(403)
    expect(payMock).not.toHaveBeenCalled()
    expect(runMock).not.toHaveBeenCalled()
    expect(sessionMock).not.toHaveBeenCalled() // gate is before auth
  })

  it('(f) flag ON + no token + no session → 401, no processing', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(401)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('(f) flag ON + wrong token + non-admin session → 403, no processing', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'resto@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'restaurant' })
    const res = await post({ token: 'nope' })
    expect(res.status).toBe(403)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('(f) cron token → batch run (no session needed)', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(200)
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('(f) admin session → batch run', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'admin@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    const res = await post()
    expect(res.status).toBe(200)
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('single mode — { creatorId } pays exactly that creator', async () => {
    const res = await post({ token: 'secret-cron', body: { creatorId: 'c9' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ mode: 'single' })
    expect(payMock).toHaveBeenCalledWith('c9')
    expect(runMock).not.toHaveBeenCalled()
  })
})
