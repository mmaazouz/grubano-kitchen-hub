import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/affiliate/join — instant affiliate onboarding route (Brique A, Agent 58) ─────
// Gated by AFFILIATE_ENABLED (OFF → 404). Owner-scoped (operator = session.user.id, never
// a client value). Idempotent. The lib + next-auth are mocked so this isolates the route's
// flag/auth/owner-scope contract.

const { enabled, ensureFn, getFn, getSession } = vi.hoisted(() => ({
  enabled:  vi.fn(),
  ensureFn: vi.fn(),
  getFn:    vi.fn(),
  getSession: vi.fn(),
}))
vi.mock('@/lib/affiliate-account', () => ({
  isAffiliateEnabled: enabled,
  ensureAffiliateOperator: ensureFn,
  getAffiliateByOperator: getFn,
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, POST } from '@/app/api/affiliate/join/route'

const post = () => POST(new Request('http://x/api/affiliate/join', { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  enabled.mockReturnValue(true)
  getSession.mockResolvedValue({ user: { id: 'op1' } })
  ensureFn.mockResolvedValue({ ok: true, created: true, roleAdded: true, affiliate: { referralCode: 'ALEX9F2K', referralLinkSlug: 'alex9f2k' } })
  getFn.mockResolvedValue({ referralCode: 'ALEX9F2K', referralLinkSlug: 'alex9f2k' })
})

describe('POST /api/affiliate/join', () => {
  it('flag OFF → 404, NO grant (surface invisible / byte-identical)', async () => {
    enabled.mockReturnValue(false)
    expect((await post()).status).toBe(404)
    expect(ensureFn).not.toHaveBeenCalled()
  })

  it('flag ON + session → instant grant (201), owner-scoped to the SESSION operator id', async () => {
    const res = await post()
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.affiliate.referralCode).toBe('ALEX9F2K')
    // owner-scope: ensureAffiliateOperator is called with the SESSION id, never a body value
    expect(ensureFn).toHaveBeenCalledWith('op1')
  })

  it('idempotent re-join → 200 (created:false)', async () => {
    ensureFn.mockResolvedValue({ ok: true, created: false, roleAdded: true, affiliate: { referralCode: 'ALEX9F2K', referralLinkSlug: 'alex9f2k' } })
    expect((await post()).status).toBe(200)
  })

  it('no session → 401, NO grant', async () => {
    getSession.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(ensureFn).not.toHaveBeenCalled()
  })
})

describe('GET /api/affiliate/join', () => {
  it('flag OFF → 404', async () => {
    enabled.mockReturnValue(false)
    expect((await GET()).status).toBe(404)
  })

  it('flag ON + session → enabled + the caller affiliate identity', async () => {
    const j = await (await GET()).json()
    expect(j.enabled).toBe(true)
    expect(j.affiliate.referralCode).toBe('ALEX9F2K')
    expect(getFn).toHaveBeenCalledWith('op1')
  })

  it('no session → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})
