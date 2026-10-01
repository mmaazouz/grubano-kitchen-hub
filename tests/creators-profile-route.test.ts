import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── PATCH/GET /api/creators/profile — self-service profile edit (P5b, Agent 22) ─
// Owner-only (session e-mail, never a client id → no IDOR), role-gated (no Creator
// row → 403), whitelist (verified channel / verification / roles / login / payout
// stripped & never written), validated (mirrors /creators/apply).

const { db, getSession } = vi.hoisted(() => ({
  db: { creator: { findUnique: vi.fn(), update: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, PATCH } from '@/app/api/creators/profile/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/creators/profile', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

const VALID = { name: 'Amina K.', bio: 'Cheffe passionnée depuis dix ans.', instagram: '@amina', tiktok: '@aminatok' }

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { email: 'amina@x.fr' } })
  db.creator.findUnique.mockResolvedValue({ id: 'cr1' })
  db.creator.update.mockResolvedValue({})
})

describe('PATCH /api/creators/profile', () => {
  it('(a) updates the signed-in creator DISPLAY fields', async () => {
    const res = await patch(VALID)
    expect(res.status).toBe(200)
    const arg = db.creator.update.mock.calls[0][0]
    expect(arg.where).toEqual({ email: 'amina@x.fr' }) // owner-only by session e-mail
    expect(arg.data).toMatchObject({ name: 'Amina K.', bio: 'Cheffe passionnée depuis dix ans.', instagram: '@amina', tiktok: '@aminatok' })
  })

  it('(b) verified-channel / verification / roles / login / payout fields in the body are IGNORED (no IDOR)', async () => {
    await patch({
      ...VALID,
      youtube: 'youtube.com/@hacker', verified: true, isChef: false, isInfluencer: false,
      email: 'other@x.fr', id: 'cr2', totalEarnings: 9999, referralCode: 'HACK', referralLinkSlug: 'hack', followers: 999999,
    })
    const arg = db.creator.update.mock.calls[0][0]
    expect(arg.where).toEqual({ email: 'amina@x.fr' }) // NOT other@x.fr / cr2
    for (const k of ['youtube', 'verified', 'isChef', 'isInfluencer', 'email', 'id', 'totalEarnings', 'referralCode', 'referralLinkSlug', 'followers']) {
      expect(arg.data).not.toHaveProperty(k)
    }
  })

  it('(c) invalid input → 400, no write', async () => {
    expect((await patch({ ...VALID, bio: 'court' })).status).toBe(400) // < 10 chars
    expect((await patch({ ...VALID, name: 'x' })).status).toBe(400)         // < 2 chars
    expect(db.creator.update).not.toHaveBeenCalled()
  })

  it('(d) unauthenticated → 401, no write', async () => {
    getSession.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(401)
    expect(db.creator.update).not.toHaveBeenCalled()
  })

  it('(e) no creator row for the session e-mail (wrong role) → 403, no write', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(403)
    expect(db.creator.update).not.toHaveBeenCalled()
  })
})

describe('GET /api/creators/profile', () => {
  it('returns the caller OWN profile (display fields + verified/roles read-only)', async () => {
    db.creator.findUnique.mockResolvedValue({
      name: 'Amina', bio: 'Bio', instagram: '@a', tiktok: null,
      youtube: 'youtube.com/@amina', verified: true, isChef: true, isInfluencer: false,
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.profile).toMatchObject({ name: 'Amina', youtube: 'youtube.com/@amina', verified: true, isChef: true, isInfluencer: false })
  })

  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('no profile → 403', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
  })
})
