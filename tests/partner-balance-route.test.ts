import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.2 — GET /api/partner/balance (Agent 38) ───────────────────────────────
// Owner-scoped read: 401 without a session; otherwise resolves the partner
// entities ONLY from the session (creator/supplier by email, restaurants by the
// session operator id) — never a client id (no IDOR). No write.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: {
    creator:         { findUnique: vi.fn() },
    supplierProfile: { findUnique: vi.fn() },
    restaurant:      { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { computeMock } = vi.hoisted(() => ({ computeMock: vi.fn() }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: computeMock }))

import { GET } from '@/app/api/partner/balance/route'

beforeEach(() => {
  vi.clearAllMocks()
  db.creator.findUnique.mockResolvedValue(null)
  db.supplierProfile.findUnique.mockResolvedValue(null)
  db.restaurant.findMany.mockResolvedValue([])
  computeMock.mockImplementation((role: string, refId: string) =>
    Promise.resolve({ role, refId, earnedCents: 100, paidCents: 0, availableCents: 100, currency: 'eur' }))
})

describe('GET /api/partner/balance', () => {
  it('(g) no session → 401, no balance computed, no read', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(computeMock).not.toHaveBeenCalled()
    expect(db.creator.findUnique).not.toHaveBeenCalled()
  })

  it('(h) session creator → returns the creator balance, scoped to the SESSION email', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'c@x', id: 'op1' } })
    db.creator.findUnique.mockResolvedValue({ id: 'c1' })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.balances).toHaveLength(1)
    expect(body.balances[0]).toMatchObject({ role: 'creator', refId: 'c1' })
    // owner-scoped: looked up by the SESSION email, never a client id
    expect(db.creator.findUnique.mock.calls[0][0].where).toEqual({ email: 'c@x' })
    expect(computeMock).toHaveBeenCalledWith('creator', 'c1')
  })

  it('(h) multi-role partner → one balance per owned entity (creator + supplier + restaurants)', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'multi@x', id: 'op9' } })
    db.creator.findUnique.mockResolvedValue({ id: 'c9' })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp9' })
    db.restaurant.findMany.mockResolvedValue([{ id: 'r9', name: 'Resto 9' }])
    const res = await GET()
    const body = await res.json()
    expect(body.balances.map((b: { role: string }) => b.role).sort()).toEqual(['creator', 'restaurant', 'supplier'])
    // restaurants scoped to the SESSION operator id (no client id)
    expect(db.restaurant.findMany.mock.calls[0][0].where).toEqual({ operatorId: 'op9', archivedAt: null })
  })

  it('(i) no IDOR — a session with no partner entity gets an empty list (cannot read another partner)', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'consumer@x', id: 'op0' } })
    const res = await GET()
    const body = await res.json()
    expect(body.balances).toEqual([])
    expect(computeMock).not.toHaveBeenCalled()
  })
})
