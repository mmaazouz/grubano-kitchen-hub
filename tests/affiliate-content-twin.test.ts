import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/affiliate/content — content studio twin for the VERIFIED affiliate (INF-2) ─
// Proves: flag OFF → 404 (byte-identical); verified-gated (403 when not verified, BEFORE
// any LLM call); owner-scoped (operator from the SESSION; quota + rate-limit keyed on it);
// the capped LLM gateway + per-id rate-limit are respected (not bypassed). The creator route
// /api/creator/affiliate-content is untouched (covered by its own test + git diff).

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { enabledMock, verifiedMock } = vi.hoisted(() => ({ enabledMock: vi.fn(), verifiedMock: vi.fn() }))
vi.mock('@/lib/influencer-verification', () => ({ isInfluencerEnabled: enabledMock, isAffiliateVerified: verifiedMock }))

const { getAffMock } = vi.hoisted(() => ({ getAffMock: vi.fn() }))
vi.mock('@/lib/affiliate-account', () => ({ getAffiliateByOperator: getAffMock }))

const { genMock, rlMock } = vi.hoisted(() => ({ genMock: vi.fn(), rlMock: vi.fn() }))
vi.mock('@/lib/affiliate-content', () => ({ generateAffiliateCaptions: genMock, rateLimitCheck: rlMock }))

vi.mock('@/lib/affiliate-link', () => ({
  buildAffiliateLink: () => '/ref/x',
  buildAffiliateRestaurantLink: () => '/ref/x?to=/fr/eat/r/r1',
}))
vi.mock('@/lib/llm', () => ({ LlmQuotaError: class LlmQuotaError extends Error {} }))

const { db } = vi.hoisted(() => ({ db: { restaurant: { findFirst: vi.fn() }, menuItem: { findFirst: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/affiliate/content/route'

const post = (body: unknown = { restaurantId: 'r1' }) =>
  POST(new Request('https://app.grubano.com/api/affiliate/content', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  enabledMock.mockReturnValue(true)
  verifiedMock.mockResolvedValue(true)
  sessionMock.mockResolvedValue({ user: { id: 'op1' } })
  getAffMock.mockResolvedValue({ operatorId: 'op1', referralCode: 'X', referralLinkSlug: 'x', status: 'active' })
  rlMock.mockReturnValue({ ok: true, remaining: 29, resetMs: 0 })
  genMock.mockResolvedValue([{ tone: 'punchy', text: 'yum /ref/x' }])
  db.restaurant.findFirst.mockResolvedValue({ id: 'r1', name: 'Resto', cuisine: [], coverPhoto: null })
  db.menuItem.findFirst.mockResolvedValue(null)
})

describe('flag + verified gating', () => {
  it('INFLUENCER_ENABLED OFF → 404, no session/LLM work', async () => {
    enabledMock.mockReturnValue(false)
    expect((await post()).status).toBe(404)
    expect(verifiedMock).not.toHaveBeenCalled()
    expect(genMock).not.toHaveBeenCalled()
  })
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })
  it('NOT verified → 403 (reserved to verified), NO LLM, NO rate-limit consumed', async () => {
    verifiedMock.mockResolvedValue(false)
    const res = await post()
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('not_verified')
    expect(rlMock).not.toHaveBeenCalled()
    expect(genMock).not.toHaveBeenCalled()
  })
  it('not an affiliate → 404', async () => {
    getAffMock.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(genMock).not.toHaveBeenCalled()
  })
})

describe('verified happy path — owner-scoped + capped', () => {
  it('generates captions; LLM quota + rate-limit keyed on the SESSION operator', async () => {
    const res = await post({ restaurantId: 'r1', locale: 'fr' })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.captions).toHaveLength(1)
    // rate-limit keyed on the session operator (owner-scoped)
    expect(rlMock).toHaveBeenCalledWith('op1')
    // LLM quota attributed to the session operator (owner-scoped)
    expect(genMock.mock.calls[0][0]).toMatchObject({ operatorId: 'op1', restaurantName: 'Resto' })
  })
  it('rate-limited → 429, NO LLM call (cap respected, not bypassed)', async () => {
    rlMock.mockReturnValue({ ok: false, remaining: 0, resetMs: 1000 })
    const res = await post()
    expect(res.status).toBe(429)
    expect(genMock).not.toHaveBeenCalled()
  })
})
