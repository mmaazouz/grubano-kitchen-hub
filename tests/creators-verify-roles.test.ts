import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

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

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

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

// ── Agent 120 (unification « recommander » incr. 3/3) ──────────────────────────
// Decision B: a creator is now purely a CHEF (recipes → royalties); the recommend/
// influencer rail moved to the Affiliate programme. A NEW creator is created CHEF-ONLY
// (isChef=true, isInfluencer=FALSE) regardless of any requested role. An EXISTING creator
// is GRANDFATHERED — finalize() preserves their stored flags exactly (null treated as true,
// matching readCreatorRoles), never downgrading an influencer nor (re)granting the role.

describe('new creators are CHEF-ONLY (decision B)', () => {
  it('omit roles → isChef=true, isInfluencer=false', async () => {
    const res = await verify('app1', {})
    expect(res.status).toBe(200)
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(true)
    expect(arg.create.isInfluencer).toBe(false)
  })

  it('explicit chef-only → isChef=true, isInfluencer=false', async () => {
    await verify('app1', { roles: { chef: true, influencer: false } })
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(true)
    expect(arg.create.isInfluencer).toBe(false)
  })

  it('EVEN an explicit influencer request creates a chef-only creator (no creator-influencer signup)', async () => {
    await verify('app1', { roles: { chef: false, influencer: true } })
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(true)
    expect(arg.create.isInfluencer).toBe(false)
  })

  it('both-false → still chef-only (never a roleless creator)', async () => {
    await verify('app1', { roles: { chef: false, influencer: false } })
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.create.isChef).toBe(true)
    expect(arg.create.isInfluencer).toBe(false)
  })
})

describe('GRANDFATHER — existing creators preserved (never downgraded)', () => {
  it('an existing isInfluencer=true creator re-verifying KEEPS isInfluencer=true', async () => {
    db.creator.findUnique.mockResolvedValue({
      id: 'cr1', isChef: true, isInfluencer: true, verified: false,
      referralCode: 'AMINAX', referralLinkSlug: 'aminax',
    })
    await verify('app1', {}) // wizard sends no roles now
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.update.isInfluencer).toBe(true)  // grandfather: kept
    expect(arg.update.isChef).toBe(true)
  })

  it('a legacy isInfluencer=null creator is treated as influencer (preserved true)', async () => {
    db.creator.findUnique.mockResolvedValue({
      id: 'cr2', isChef: null, isInfluencer: null, verified: false,
      referralCode: 'LEGACYX', referralLinkSlug: 'legacyx',
    })
    await verify('app1', {})
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.update.isInfluencer).toBe(true)  // null → true (matches readCreatorRoles)
  })

  it('an existing chef-only creator stays chef-only on re-verify (no auto-grant)', async () => {
    db.creator.findUnique.mockResolvedValue({
      id: 'cr3', isChef: true, isInfluencer: false, verified: false,
      referralCode: 'CHEFX', referralLinkSlug: 'chefx',
    })
    await verify('app1', { roles: { chef: false, influencer: true } }) // even if influencer requested
    const arg = db.creator.upsert.mock.calls[0][0]
    expect(arg.update.isInfluencer).toBe(false) // stays chef-only
  })
})
