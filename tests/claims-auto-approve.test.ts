import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.5-C1 — POST /api/admin/claims/auto-approve (cron) ─────────────────────────
// Gate order: CLAIMS_ENABLED (403 gated) → P0-25 CLAIMS_AUTO_APPROVE_ENABLED (403
// gated explicite, défaut OFF toute la bêta — le sweep auto_timeout rembourse sans
// humain) → X-Internal-Token OR admin session (401/403). Mirrors creator-payouts/run.

const { flag, autoFlag, runMock } = vi.hoisted(() => ({ flag: vi.fn(), autoFlag: vi.fn(), runMock: vi.fn() }))
vi.mock('@/lib/claims', () => ({ isClaimsEnabled: flag, isClaimsAutoApproveEnabled: autoFlag, runClaimAutoApproval: runMock }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/admin/claims/auto-approve/route'

const post = (opts: { token?: string } = {}) =>
  POST(new Request('https://app.grubano.com/api/admin/claims/auto-approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-internal-token': opts.token } : {}) },
    body: '{}',
  }))

beforeEach(() => {
  vi.clearAllMocks()
  flag.mockReturnValue(true)
  autoFlag.mockReturnValue(true) // les tests de passage supposent le flag P0-25 ON (post-bêta)
  runMock.mockResolvedValue({ autoApproved: 2, refundsTriggered: 2, refundsPending: 0, refundsFailed: 0, scannedExpired: 2, scannedPending: 0 })
  process.env.INTERNAL_CRON_TOKEN = 'secret-cron'
})
afterEach(() => { delete process.env.INTERNAL_CRON_TOKEN })

describe('POST /api/admin/claims/auto-approve', () => {
  it('(f) flag OFF → 403 gated, BEFORE auth', async () => {
    flag.mockReturnValue(false)
    const res = await post()
    expect(res.status).toBe(403)
    expect(runMock).not.toHaveBeenCalled()
    expect(sessionMock).not.toHaveBeenCalled()
  })

  // ⭐ P0-25 — CRITÈRE D'ACCEPTATION : configuration bêta (flag dédié OFF, son défaut)
  // → AUCUN remboursement possible via cette route, refus EXPLICITE et tracé, même
  // avec un token cron valide ou un admin.
  it('(P0-25) CLAIMS_AUTO_APPROVE_ENABLED OFF (défaut bêta) → 403 explicite nommant le flag, AUCUN sweep, même token cron valide', async () => {
    autoFlag.mockReturnValue(false)
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ gated: true, flag: 'CLAIMS_AUTO_APPROVE_ENABLED' })
    expect(body.error).toMatch(/validation humaine/i)
    expect(runMock).not.toHaveBeenCalled()  // zéro remboursement, zéro sweep
    expect(sessionMock).not.toHaveBeenCalled() // gate AVANT auth
  })

  it('(P0-25) idem pour une session admin : flag OFF → 403, aucun sweep', async () => {
    autoFlag.mockReturnValue(false)
    sessionMock.mockResolvedValue({ user: { email: 'admin@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    expect((await post()).status).toBe(403)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('no token + no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('wrong token + non-admin session → 403', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'resto@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'restaurant' })
    expect((await post({ token: 'nope' })).status).toBe(403)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('cron token → runs the sweep', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await post({ token: 'secret-cron' })
    expect(res.status).toBe(200)
    expect(runMock).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ ok: true, autoApproved: 2, refundsTriggered: 2 })
  })

  it('admin session → runs', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'admin@x' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    expect((await post()).status).toBe(200)
    expect(runMock).toHaveBeenCalledTimes(1)
  })
})
