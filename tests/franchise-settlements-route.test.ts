import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4-Franchise-B — POST /api/admin/franchise-settlements/run (Agent 42) ────────
// Gate order: (1) FRANCHISE_SETTLEMENT_ENABLED OFF → 403 BEFORE anything; (2) auth =
// INTERNAL_CRON_TOKEN header OR admin session (401/403). Body { operatorId } → single,
// else batch. The settlement lib is mocked (tested separately) — here we lock the gate.

const { flagMock, settleMock, runMock } = vi.hoisted(() => ({
  flagMock: vi.fn(), settleMock: vi.fn(), runMock: vi.fn(),
}))
vi.mock('@/lib/franchise-settlement', () => ({
  isFranchiseSettlementEnabled: flagMock,
  settleFranchisor: settleMock,
  runFranchiseSettlements: runMock,
}))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/admin/franchise-settlements/run/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.FRANCHISE_ENABLED = 'true' })
afterEach(() => { delete process.env.FRANCHISE_ENABLED })

const req = (opts: { token?: string; body?: unknown } = {}) =>
  new Request('http://x/api/admin/franchise-settlements/run', {
    method: 'POST',
    headers: opts.token ? { 'x-internal-token': opts.token } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = 'secret'
  flagMock.mockReturnValue(true)
  sessionMock.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue({ role: 'admin' })
  settleMock.mockResolvedValue({ status: 'settled', operatorId: 'op1', amountCents: 300, lineCount: 2, stripeTransferId: 'tr_1', settlementId: 'SID', resumed: false })
  runMock.mockResolvedValue({ processed: 1, settled: 1, skipped: 0, failed: 0, results: [] })
})
afterEach(() => { delete process.env.INTERNAL_CRON_TOKEN })

describe('gate 1 — kill-switch', () => {
  it('(h) flag OFF → 403, NO auth check, NO settlement work', async () => {
    flagMock.mockReturnValue(false)
    const res = await POST(req({ token: 'secret' }))
    expect(res.status).toBe(403)
    expect((await res.json()).gated).toBe(true)
    expect(sessionMock).not.toHaveBeenCalled()
    expect(settleMock).not.toHaveBeenCalled()
    expect(runMock).not.toHaveBeenCalled()
  })
})

describe('gate 2 — auth (cron token OR admin)', () => {
  it('no token + no session → 401, no settlement', async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(settleMock).not.toHaveBeenCalled()
    expect(runMock).not.toHaveBeenCalled()
  })

  it('wrong token + non-admin session → 403, no settlement', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'u@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'restaurant' })
    const res = await POST(req({ token: 'WRONG' }))
    expect(res.status).toBe(403)
    expect(settleMock).not.toHaveBeenCalled()
    expect(runMock).not.toHaveBeenCalled()
  })

  it('valid cron token → batch runs (no session lookup needed)', async () => {
    const res = await POST(req({ token: 'secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, mode: 'batch', settled: 1 })
    expect(sessionMock).not.toHaveBeenCalled()
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('admin session (no token) → single settlement for the given operatorId', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'admin@x' } })
    const res = await POST(req({ body: { operatorId: 'op1' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, mode: 'single' })
    expect(settleMock).toHaveBeenCalledWith('op1')
    expect(runMock).not.toHaveBeenCalled()
  })
})
