import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/creators/apply/[id]/verify — role assignment (Mission 14) ───────
// Proves the DURABLE role write (the application row is a transient vetting
// artifact; the Creator upsert at verify time is the source of truth). A PURE
// influencer (influencer ✔ / chef ✘) with NO dish concepts and NO YouTube
// (Path B) upserts a Creator with isChef=false / isInfluencer=true — the empty
// portfolio never blocks vetting. Chef / both / legacy paths are unaffected.
// prisma + the LLM vetting are mocked; the YouTube libs are mocked but unused on
// Path B (no channel declared).

const { db } = vi.hoisted(() => ({
  db: {
    creatorApplication: { findUnique: vi.fn(), update: vi.fn() },
    creator:            { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    // Phase 0/3 auth bridge — finalize() activates + records the creator role.
    operator:           { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    operatorRole:       { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { vetMock } = vi.hoisted(() => ({ vetMock: vi.fn() }))
vi.mock('@/lib/creator-vetting', () => ({ vetCreator: vetMock }))
vi.mock('@/lib/youtube', () => ({
  hasYouTubeKey:        vi.fn(() => true),
  resolveChannelId:     vi.fn(),
  getChannelStats:      vi.fn(),
  getRecentVideoTitles: vi.fn(),
}))

import { POST } from '@/app/api/creators/apply/[id]/verify/route'

const verify = (id: string, body: Record<string, unknown>) =>
  POST(
    new Request(`https://business.grubano.com/api/creators/apply/${id}/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }),
    { params: { id } },
  )

beforeEach(() => {
  vi.clearAllMocks()
  // A pure-influencer application: no YouTube (Path B), empty portfolio.
  db.creatorApplication.findUnique.mockResolvedValue({
    id: 'app1', name: 'Amina K.', email: 'amina@exemple.fr',
    bio: 'Je cuisine healthy depuis 10 ans.',
    instagram: null, tiktok: null, youtube: '', followers: 4200,
    status: 'pending', dishConcepts: [],
  })
  db.creator.findUnique.mockResolvedValue(null) // brand-new creator
  db.creator.findFirst.mockResolvedValue(null)  // referral code has no clash
  db.creator.upsert.mockResolvedValue({ id: 'cr1', verified: false, referralLinkSlug: 'aminaab12' })
  db.creatorApplication.update.mockResolvedValue({})
  db.operator.findUnique.mockResolvedValue(null) // bridge creates an active creator Operator
  db.operator.create.mockResolvedValue({ id: 'op1' })
  db.operator.update.mockResolvedValue({})
  db.operatorRole.upsert.mockResolvedValue({})
  vetMock.mockResolvedValue({ verdict: 'pass', reason: 'ok' })
})

describe('influencer-only — roles assigned without a portfolio', () => {
  it('upserts the Creator with isChef=false / isInfluencer=true (Path B)', async () => {
    const res = await verify('app1', { roles: { chef: false, influencer: true } })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.ok).toBe(true)

    expect(db.creator.upsert).toHaveBeenCalledTimes(1)
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(false)
    expect(arg.create.isInfluencer).toBe(true)
    // Vetting ran on the (empty) portfolio — never blocked by it — and the
    // role is forwarded so the OPEN influencer barème applies (Mission 14).
    expect(vetMock).toHaveBeenCalledWith({
      bio: expect.any(String),
      dishConcepts: [],
      roles: { chef: false, influencer: true },
    })
  })
})

describe('chef / both / legacy paths unchanged', () => {
  it('upserts isChef=true / isInfluencer=false when only chef is chosen', async () => {
    const res = await verify('app1', { roles: { chef: true, influencer: false } })
    expect(res.status).toBe(200)
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(true)
    expect(arg.create.isInfluencer).toBe(false)
  })

  it('defaults to BOTH roles when the body omits roles (legacy client)', async () => {
    const res = await verify('app1', {})
    expect(res.status).toBe(200)
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(true)
    expect(arg.create.isInfluencer).toBe(true)
  })

  it('coerces both-false to both-true (never a roleless creator)', async () => {
    const res = await verify('app1', { roles: { chef: false, influencer: false } })
    expect(res.status).toBe(200)
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(true)
    expect(arg.create.isInfluencer).toBe(true)
  })
})
