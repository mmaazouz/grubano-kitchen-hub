import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

// ── P4.5-C2 — routes: client contest + admin queue + admin arbitrate ─────────────
// Flag gating, client owner-scoping (session token), admin-only (session role). lib +
// auth mocked.
//
// D′ L1 (spec v2 §3): the gate is lib/claim-flags (process.env only) — no longer a function of lib/claims a mock
// could answer. The SURFACE is opened here the legacy way (the lease, S-12: every gate ≡ isClaimsEnabled() when no
// product flag is set) and closed by removing it. GET /api/admin/claims is SPLIT by the surface (§3.2): closed ⇒
// workflow lists EMPTY, enabled:false, the MONEY list still returned for an admin.

const { contestMock, arbitrateMock, queueMock, pendingMock, moneyMock } = vi.hoisted(() => ({
  contestMock: vi.fn(), arbitrateMock: vi.fn(), queueMock: vi.fn(),
  // P0-39 — la route admin liste AUSSI les réclamations en attente du resto.
  pendingMock: vi.fn(async () => []),
  // Claims batch 1 / D′ L1: the money list, returned even when the surface is closed.
  moneyMock: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
}))
vi.mock('@/lib/claims', () => ({
  contestClaim: contestMock,
  arbitrateClaim: arbitrateMock,
  listArbitrationQueue: queueMock,
  listPendingRestaurantClaims: pendingMock,
  // Claims batch 1: the admin route now also reads the money list and the silence list.
  listActionableRefundClaims: moneyMock,
  listSilenceExpiredClaims: vi.fn(async () => []),
}))
const PRODUCT_FLAGS = ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'] as const

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
// ROUND-8 AUDIT FIX (P2): the arbitrate route now authorises through resolveAdmin — the role set
// re-read from the DB — instead of the sign-in JWT claims. Only the arbitrate route imports it here.
const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))

import { POST as CONTEST } from '@/app/api/claims/[id]/contest/route'
import { GET as ADMIN_LIST } from '@/app/api/admin/claims/route'
import { POST as ARBITRATE } from '@/app/api/admin/claims/[id]/arbitrate/route'

const reqJson = (body?: unknown) => ({ json: async () => body ?? {} }) as never

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of PRODUCT_FLAGS) delete process.env[k]
  openClaimsWindow() // D′ L1: the real gate, opened as Mode A/B opened it
  tokenMock.mockResolvedValue({ sub: 'c1' })
  sessionMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } })
  adminMock.mockResolvedValue({ id: 'admin1', role: 'admin', name: 'Admin', email: 'admin1@grubano.test' })
  contestMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'arbitration' } })
  arbitrateMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'approved' }, refund: { state: 'refunded', refundId: 'rf1' } })
  queueMock.mockResolvedValue([])
  moneyMock.mockResolvedValue([])
})
afterEach(() => { closeClaimsWindow(); for (const k of PRODUCT_FLAGS) delete process.env[k] })

describe('POST /api/claims/[id]/contest (client)', () => {
  it('surface CLOSED (no lease) → 403 gated', async () => {
    closeClaimsWindow()
    const res = await CONTEST(reqJson({ reason: 'x' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    expect(contestMock).not.toHaveBeenCalled()
  })
  it('D′ L1 — the product SURFACE alone (no lease) opens contest; INTAKE alone opens nothing (fail-closed)', async () => {
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'true' // no INTAKE: contesting an existing claim needs no intake
    expect((await CONTEST(reqJson({ reason: 'x' }), { params: { id: 'cl1' } })).status).toBe(200)
    delete process.env.CLAIMS_SURFACE_ENABLED; process.env.CLAIMS_INTAKE_ENABLED = 'true'
    expect((await CONTEST(reqJson({ reason: 'x' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(contestMock).toHaveBeenCalledTimes(1)
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
  it('D′ L1 (spec v2 §3.2) — surface CLOSED · admin → enabled:false, workflow lists EMPTY and NOT read, the MONEY list still returned and counted', async () => {
    closeClaimsWindow()
    moneyMock.mockResolvedValue([{ id: 'm1', moneyState: 'approved_not_driven' }])
    const res = await ADMIN_LIST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: false, claims: [], pending: [], silenceExpired: [],
      actionableRefunds: [{ id: 'm1', moneyState: 'approved_not_driven' }],
      counts: { arbitration: 0, silenceExpired: 0, legacyPendingMoney: 0, actionableRefunds: 1, actionableTotal: 1 },
    })
    expect(queueMock).not.toHaveBeenCalled()
    expect(pendingMock).not.toHaveBeenCalled()
    expect(moneyMock).toHaveBeenCalledTimes(1)
  })
  it('surface CLOSED · NOT an admin → {enabled:false} 200 only (the pre-L1 shape; no money list for a non-admin) — NEGATIVE CONTROL of the split', async () => {
    closeClaimsWindow()
    adminMock.mockResolvedValue(null)
    moneyMock.mockResolvedValue([{ id: 'm1' }])
    const res = await ADMIN_LIST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(moneyMock).not.toHaveBeenCalled()
  })
  // ROUND-13 (round-12 audit, P3): the admin list authorises through resolveAdmin (role set re-read), like
  // every other admin claims route — no session and a non-admin both resolve to null → 403.
  it('not an admin (no session, or a non-admin role set) → 403', async () => {
    adminMock.mockResolvedValue(null)
    expect((await ADMIN_LIST()).status).toBe(403)
    expect(queueMock).not.toHaveBeenCalled()
  })
  it('a sign-in JWT that still says admin is NOT enough — the re-read role set decides', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
    adminMock.mockResolvedValue(null)
    expect((await ADMIN_LIST()).status).toBe(403)
  })
  it('admin → arbitration queue', async () => {
    const res = await ADMIN_LIST()
    expect(res.status).toBe(200)
    expect(queueMock).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ enabled: true })
  })
})

describe('POST /api/admin/claims/[id]/arbitrate', () => {
  it('surface CLOSED (no lease) → 403 gated', async () => {
    closeClaimsWindow()
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(arbitrateMock).not.toHaveBeenCalled()
  })
  it('D′ L1 — an EXPIRED lease is closed too; the product SURFACE alone (INTAKE false) still lets an admin decide', async () => {
    openClaimsWindow(-1000)
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(arbitrateMock).not.toHaveBeenCalled()
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'true'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(200)
    expect(arbitrateMock).toHaveBeenCalledTimes(1)
  })
  it('non-admin → 403, no arbitration', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'consumer' } })
    adminMock.mockResolvedValue(null)
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(arbitrateMock).not.toHaveBeenCalled()
  })
  it('ROUND-8 (P2): a session JWT that still SAYS admin, for an operator whose admin role was removed → 403, no arbitration', async () => {
    // The JWT is filled at sign-in and never refreshed; the approve that can move money must not
    // trust it. resolveAdmin re-reads the role set from the DB and finds no admin.
    sessionMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin', roles: ['admin'] } })
    adminMock.mockResolvedValue(null)
    expect((await ARBITRATE(reqJson({ decision: 'approve' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(arbitrateMock).not.toHaveBeenCalled()
  })
  it('admin approve → arbitrateClaim with adminId from resolveAdmin (role set re-read from the DB)', async () => {
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
