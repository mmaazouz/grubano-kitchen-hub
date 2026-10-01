import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.2 — maturation cron security (Agent 38) ───────────────────────────────
// The maturation route is UNCHANGED by P4.2; this test PINS its existing cron
// security so it is safe to schedule: the INTERNAL_CRON_TOKEN header opens it
// without a session, and without that token (and no admin/restaurant session) it
// is refused. matureCreatorEarnings is itself idempotent (scans only 'pending').

const { matureMock } = vi.hoisted(() => ({ matureMock: vi.fn() }))
vi.mock('@/lib/creator-earnings', () => ({ matureCreatorEarnings: matureMock }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/admin/creator-earnings/mature/route'

// P0-06 — rôle créateur ouvert pour ces tests (la surface est derrière CREATOR_ENABLED,
// 404 OFF prouvé par tests/role-locks.test.ts) ; ici on teste la logique métier.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

const post = (token?: string) =>
  POST(new Request('https://app.grubano.com/api/admin/creator-earnings/mature', {
    method: 'POST', headers: token ? { 'x-internal-token': token } : {},
  }))

beforeEach(() => {
  vi.clearAllMocks()
  matureMock.mockResolvedValue({ scanned: { referralOrders: 0, dishSales: 0 }, matured: 0, cancelled: 0, pending: 0, reasons: {} })
  process.env.INTERNAL_CRON_TOKEN = 'secret-cron'
})
afterEach(() => { delete process.env.INTERNAL_CRON_TOKEN })

describe('POST /api/admin/creator-earnings/mature — cron security', () => {
  it('(j) no token + no session → 401, maturation NOT run', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(401)
    expect(matureMock).not.toHaveBeenCalled()
  })

  it('(j) wrong token + no session → 401, maturation NOT run', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post('nope')
    expect(res.status).toBe(401)
    expect(matureMock).not.toHaveBeenCalled()
  })

  it('(j) correct cron token → runs maturation (no session needed)', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post('secret-cron')
    expect(res.status).toBe(200)
    expect(matureMock).toHaveBeenCalledTimes(1)
  })

  it('(j) idempotent to re-run — two scheduled calls both delegate to the idempotent batch', async () => {
    sessionMock.mockResolvedValue(null)
    await post('secret-cron')
    await post('secret-cron')
    expect(matureMock).toHaveBeenCalledTimes(2) // each call runs the batch; the batch itself only touches 'pending'
  })

  it('no token but ADMIN session → runs (existing session fallback)', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'admin@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    const res = await post()
    expect(res.status).toBe(200)
    expect(matureMock).toHaveBeenCalledTimes(1)
  })

  it('no token + non-admin/non-restaurant session → 403, maturation NOT run', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'consumer@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'consumer' })
    const res = await post()
    expect(res.status).toBe(403)
    expect(matureMock).not.toHaveBeenCalled()
  })
})
