import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/brands/[id] franchise-conditions edit (B4, Agent 46) ────────────────────
// Owner-scoped (operator resolved from SESSION email, never a client id → no IDOR),
// franchise fields validated server-side (royaltyPct is a FRACTION bounded [0,0.5]).
// Mirrors the existing brands/[id] authorize() pattern.

const { db, getSession } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn() }, brand: { findUnique: vi.fn(), update: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, PATCH } from '@/app/api/brands/[id]/route'

// The route always returns a NextResponse at runtime; `!` collapses the pre-existing
// `| undefined` type imprecision from authorize()'s union narrowing.
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/brands/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } }).then((r) => r!)

const OWNED = {
  id: 'b1', operatorId: 'op1', name: 'Marco', emoji: '🍕', cuisineType: null, tagline: null, status: 'active',
  openToFranchise: false, royaltyPct: null, setupFee: null, franchiseZones: [], franchiseStatus: 'none',
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { email: 'owner@x' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.brand.findUnique.mockResolvedValue(OWNED)
  db.brand.update.mockResolvedValue({ ...OWNED, openToFranchise: true })
})

describe('PATCH /api/brands/[id] — franchise conditions', () => {
  it('(e) owner edits the franchise fields → 200, persisted', async () => {
    const res = await patch('b1', { openToFranchise: true, royaltyPct: 0.08, setupFee: 500, franchiseZones: ['Paris', 'Lyon'], franchiseStatus: 'open' })
    expect(res.status).toBe(200)
    expect(db.brand.update.mock.calls[0][0].where).toEqual({ id: 'b1' })
    expect(db.brand.update.mock.calls[0][0].data).toMatchObject({
      openToFranchise: true, royaltyPct: 0.08, setupFee: 500, franchiseZones: ['Paris', 'Lyon'], franchiseStatus: 'open',
    })
  })

  it('royaltyPct out of range (>50%) → 400, NO update', async () => {
    expect((await patch('b1', { royaltyPct: 0.9 })).status).toBe(400)
    expect(db.brand.update).not.toHaveBeenCalled()
  })

  it('royaltyPct = 0 (explicit 0% brand) is accepted', async () => {
    expect((await patch('b1', { royaltyPct: 0 })).status).toBe(200)
    expect(db.brand.update.mock.calls[0][0].data.royaltyPct).toBe(0)
  })

  it('invalid franchiseStatus → 400', async () => {
    expect((await patch('b1', { franchiseStatus: 'hacked' })).status).toBe(400)
    expect(db.brand.update).not.toHaveBeenCalled()
  })

  it('non-owner (different operator, not admin) → 403, no update (no IDOR)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op2', role: 'restaurant' })
    expect((await patch('b1', { royaltyPct: 0.08 })).status).toBe(403)
    expect(db.brand.update).not.toHaveBeenCalled()
  })

  it('admin may edit any brand', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'admin1', role: 'admin' })
    expect((await patch('b1', { royaltyPct: 0.07 })).status).toBe(200)
  })

  it('brand not found → 404', async () => {
    db.brand.findUnique.mockResolvedValue(null)
    expect((await patch('ghost', { royaltyPct: 0.08 })).status).toBe(404)
  })

  it('unauthenticated → 401, no update', async () => {
    getSession.mockResolvedValue(null)
    expect((await patch('b1', { royaltyPct: 0.08 })).status).toBe(401)
    expect(db.brand.update).not.toHaveBeenCalled()
  })
})

describe('GET /api/brands/[id] — returns franchise conditions', () => {
  it('owner sees the franchise fields', async () => {
    db.brand.findUnique.mockResolvedValue({ ...OWNED, royaltyPct: 0.08, openToFranchise: true, franchiseStatus: 'open', franchiseZones: ['Paris'] })
    const res = (await GET(new Request('http://x/api/brands/b1'), { params: { id: 'b1' } }))!
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.brand).toMatchObject({ royaltyPct: 0.08, openToFranchise: true, franchiseStatus: 'open', franchiseZones: ['Paris'] })
  })
})
