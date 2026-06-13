import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/creator/affiliate-content — Studio de contenu 2b (Agent 14) ──────
// Session-aware (email, never ?creatorId), isInfluencer-gated, rate-limited,
// READ-ONLY. The LLM + limiter are mocked (the pure engine is covered separately);
// the REAL lib/affiliate-link runs so we prove the affiliate link is wired in.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: {
    creator:    { findUnique: vi.fn() },
    restaurant: { findFirst: vi.fn() },
    menuItem:   { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { genMock, rlMock } = vi.hoisted(() => ({ genMock: vi.fn(), rlMock: vi.fn() }))
vi.mock('@/lib/affiliate-content', () => ({
  generateAffiliateCaptions: genMock,
  rateLimitCheck: rlMock,
}))

import { POST } from '@/app/api/creator/affiliate-content/route'

const makeReq = (body: unknown) =>
  new Request('https://app.grubano.com/api/creator/affiliate-content', {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const CREATOR = { id: 'cr1', referralCode: 'MARCO20', referralLinkSlug: 'marco20', isChef: true, isInfluencer: true }

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'creator@example.com' } })
  db.creator.findUnique.mockResolvedValue(CREATOR)
  db.restaurant.findFirst.mockResolvedValue({ id: 'rest1', name: 'Gnocchi Bar', cuisine: ['italien'], coverPhoto: 'https://img/x.jpg' })
  db.menuItem.findFirst.mockResolvedValue(null)
  rlMock.mockReturnValue({ ok: true, remaining: 29, resetMs: 1000 })
  genMock.mockResolvedValue([{ tone: 'punchy', text: 'Yum! https://grubano.com/ref/marco20' }])
})

describe('auth + gating', () => {
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await POST(makeReq({ restaurantId: 'rest1' }))).status).toBe(401)
  })
  it('no creator → 404', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    expect((await POST(makeReq({ restaurantId: 'rest1' }))).status).toBe(404)
  })
  it('non-influencer → 403 (no LLM call)', async () => {
    db.creator.findUnique.mockResolvedValue({ ...CREATOR, isInfluencer: false })
    expect((await POST(makeReq({ restaurantId: 'rest1' }))).status).toBe(403)
    expect(genMock).not.toHaveBeenCalled()
  })
  it('rate-limited → 429 (no LLM call)', async () => {
    rlMock.mockReturnValue({ ok: false, remaining: 0, resetMs: 5000 })
    const res = await POST(makeReq({ restaurantId: 'rest1' }))
    expect(res.status).toBe(429)
    expect(genMock).not.toHaveBeenCalled()
  })
})

describe('generation', () => {
  it('success → captions + the affiliate deep link wired into the LLM input', async () => {
    const res = await POST(makeReq({ restaurantId: 'rest1', locale: 'fr' }))
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.captions).toHaveLength(1)
    expect(out.target.restaurantName).toBe('Gnocchi Bar')
    // REAL link builder ran (server origin) → /ref/<slug>?to=/fr/eat/r/rest1.
    expect(out.link).toContain('/ref/marco20')
    expect(out.link).toContain('?to=' + encodeURIComponent('/fr/eat/r/rest1'))
    // The LLM was asked to embed that exact link.
    const arg = genMock.mock.calls[0][0]
    expect(arg.link).toBe(out.link)
    expect(arg.restaurantName).toBe('Gnocchi Bar')
  })
  it('unknown restaurant → 404', async () => {
    db.restaurant.findFirst.mockResolvedValue(null)
    expect((await POST(makeReq({ restaurantId: 'nope' }))).status).toBe(404)
  })
  it('LLM unavailable → clean 502', async () => {
    genMock.mockResolvedValue(null)
    expect((await POST(makeReq({ restaurantId: 'rest1' }))).status).toBe(502)
  })
})
