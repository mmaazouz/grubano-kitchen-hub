import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── PATCH /api/creators/me/roles — Agent 120 (unification « recommander » incr. 3/3) ──
// The recommend/influencer rail moved to the Affiliate programme. A creator can no longer
// ACTIVATE the influencer flag from the dashboard toggle: a false→true transition is REFUSED
// (409). An EXISTING influencer is GRANDFATHERED — current=true is never blocked (they keep it,
// may toggle it off themselves). The "at least one role" + auth guards are unchanged.

const { db, getSession, rolesMock } = vi.hoisted(() => ({
  db: { creator: { findUnique: vi.fn(), update: vi.fn() } },
  getSession: vi.fn(),
  rolesMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/creator-roles', () => ({ readCreatorRoles: rolesMock }))

import { PATCH } from '@/app/api/creators/me/roles/route'

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/creators/me/roles', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { email: 'amina@exemple.fr' } })
  db.creator.findUnique.mockResolvedValue({ id: 'cr1' })
  db.creator.update.mockResolvedValue({})
  rolesMock.mockResolvedValue({ isChef: true, isInfluencer: false }) // chef-only by default
})

describe('influencer activation is closed (recommend rail = Affiliate)', () => {
  it('a chef-only creator CANNOT activate influencer (false→true) → 409, no write', async () => {
    const res = await patch({ isInfluencer: true })
    expect(res.status).toBe(409)
    expect(db.creator.update).not.toHaveBeenCalled()
  })

  it('a chef-only creator can still manage their chef flag (no influencer change) → 200', async () => {
    const res = await patch({ isChef: true })
    expect(res.status).toBe(200)
    expect(db.creator.update).toHaveBeenCalledTimes(1)
    expect(db.creator.update.mock.calls[0][0].data).toEqual({ isChef: true, isInfluencer: false })
  })
})

describe('GRANDFATHER — an existing influencer keeps their rail', () => {
  beforeEach(() => { rolesMock.mockResolvedValue({ isChef: true, isInfluencer: true }) })

  it('an existing influencer re-affirming isInfluencer:true is allowed (current=true, not a false→true) → 200', async () => {
    const res = await patch({ isInfluencer: true })
    expect(res.status).toBe(200)
    expect(db.creator.update.mock.calls[0][0].data.isInfluencer).toBe(true)
  })

  it('an existing influencer may turn it OFF themselves → 200', async () => {
    const res = await patch({ isInfluencer: false })
    expect(res.status).toBe(200)
    expect(db.creator.update.mock.calls[0][0].data.isInfluencer).toBe(false)
  })
})

describe('unchanged guards', () => {
  it('both roles off → 400 (at least one active)', async () => {
    rolesMock.mockResolvedValue({ isChef: true, isInfluencer: false })
    const res = await patch({ isChef: false }) // influencer already false → both off
    expect(res.status).toBe(400)
    expect(db.creator.update).not.toHaveBeenCalled()
  })

  it('no session → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await patch({ isChef: true })).status).toBe(401)
  })

  it('no creator profile → 404', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    expect((await patch({ isChef: true })).status).toBe(404)
  })
})
