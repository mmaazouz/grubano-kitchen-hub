import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.5-C2 — routes: client contest + admin queue + admin arbitrate ─────────────
// Flag gating, client owner-scoping (session token), admin-only (session role). lib +
// auth mocked.

const { flag, contestMock, arbitrateMock, queueMock } = vi.hoisted(() => ({
  flag: vi.fn(), contestMock: vi.fn(), arbitrateMock: vi.fn(), queueMock: vi.fn(),
}))
vi.mock('@/lib/claims', () => ({
  isClaimsEnabled: flag,
  contestClaim: contestMock,
  arbitrateClaim: arbitrateMock,
  listArbitrationQueue: queueMock,
}))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { POST as CONTEST } from '@/app/api/claims/[id]/contest/route'
import { GET as ADMIN_LIST } from '@/app/api/admin/claims/route'
import { POST as ARBITRATE } from '@/app/api/admin/claims/[id]/arbitrate/route'

const reqJson = (body?: unknown) => ({ json: async () => body ?? {} }) as never

beforeEach(() => {
  vi.clearAllMocks()
  flag.mockReturnValue(true)
  tokenMock.mockResolvedValue({ sub: 'c1' })
  sessionMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } })
  contestMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'arbitration' } })
  arbitrateMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'approved' }, refund: { state: 'refunded', refundId: 'rf1' } })
  queueMock.mockResolvedValue([])
})

describe('POST /api/claims/[id]/contest (client)', () => {
  it('flag OFF → 403', async () => {
    flag.mockReturnValue(false)
    expect((await CONTEST(reqJson({ reason: 'x' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(contestMock).not.toHaveBeenCalled()
  })
  it('no session → 401', async () => {
    tokenMock.mockResolvedValue(null)
    expect((await CONTEST(reqJson({}), { params: { id: 'cl1' } })).status).toBe(401)
  })
  it('valid → contestClaim with consumerId from session (never client-supplied)', async () => {
    const res = await CONTEST(reqJson({ reason: 'désaccord' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(contestMock).toHaveBeenCalledWith({ claimId: 'cl1', consumerId: 'c1', reason: 'désaccord' })
  })
  it('engine 404 (IDOR) surfaced', async () => {
    contestMock.mockResolvedValue({ ok: false, status: 404, error: 'introuvable' })
    expect((await CONTEST(reqJson({}), { params: { id: 'cl1' } })).status).toBe(404)
  })
})

describe('GET /api/admin/claims', () => {
  it('flag OFF → enabled:false', async () => {
    flag.mockReturnValue(false)
    expect(await (await ADMIN_LIST()).json()).toEqual({ enabled: false })
  })
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await ADMIN_LIST()).status).toBe(401)
  })
  it('non-admin → 403', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'restaurant' } })
    expect((await ADMIN_LIST()).status).toBe(403)
    expect(queueMock).not.toHaveBeenCalled()
  })
  it('admin → arbitration queue', async () => {
    const res = await ADMIN_LIST()
    expect(res.status).toBe(200)
    expect(queueMock).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ enabled: true })
  })
})

describe('POST /api/admin/claims/[id]/arbitrate', () => {
  it('flag OFF → 403', async () => {
    flag.mockReturnValue(false)
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(arbitrateMock).not.toHaveBeenCalled()
  })
  it('non-admin → 403, no arbitration', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'consumer' } })
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(arbitrateMock).not.toHaveBeenCalled()
  })
  it('admin approve → arbitrateClaim with adminId from session', async () => {
    const res = await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(arbitrateMock).toHaveBeenCalledWith({ claimId: 'cl1', adminId: 'admin1', decision: 'approve', reason: undefined })
  })
  it('admin refuse_final with reason', async () => {
    arbitrateMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'refused_final' }, refund: null })
    await ARBITRATE(reqJson({ decision: 'refuse_final', reason: 'insuffisant' }), { params: { id: 'cl1' } })
    expect(arbitrateMock).toHaveBeenCalledWith({ claimId: 'cl1', adminId: 'admin1', decision: 'refuse_final', reason: 'insuffisant' })
  })
  it('invalid decision → 400', async () => {
    expect((await ARBITRATE(reqJson({ decision: 'maybe' }), { params: { id: 'cl1' } })).status).toBe(400)
  })
  it('engine 409 (already arbitrated) surfaced', async () => {
    arbitrateMock.mockResolvedValue({ ok: false, status: 409, error: 'déjà arbitrée' })
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(409)
  })
})
