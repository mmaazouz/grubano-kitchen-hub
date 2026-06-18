import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4-UI — GET /api/partner/payouts (Agent 40) ──────────────────────────────
// Read-only payout history for the SESSION creator + the CREATOR_CONNECT_ENABLED
// flag (so the client can hide the section). 401 without a session; owner-scoped
// (creator resolved by session email, never a client id → no IDOR); no write.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: { creator: { findUnique: vi.fn() }, payout: { findMany: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { flagMock } = vi.hoisted(() => ({ flagMock: vi.fn() }))
vi.mock('@/lib/connect-onboarding', () => ({ isConnectOnboardingEnabled: flagMock }))

import { GET } from '@/app/api/partner/payouts/route'

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockReturnValue(true)
  db.creator.findUnique.mockResolvedValue({ id: 'c1' })
  db.payout.findMany.mockResolvedValue([{ id: 'po1', amountCents: 5000, currency: 'eur', status: 'paid', paidAt: null, stripeTransferId: 'tr_1', createdAt: new Date() }])
})

describe('GET /api/partner/payouts', () => {
  it('(a) no session → 401, no read', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(db.creator.findUnique).not.toHaveBeenCalled()
    expect(db.payout.findMany).not.toHaveBeenCalled()
  })

  it('(b) session creator → returns its OWN payouts, scoped to the session email + creatorId', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'c@x' } })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.payouts).toHaveLength(1)
    // owner-scoped: creator looked up by SESSION email, payouts by the resolved creatorId (no client id)
    expect(db.creator.findUnique.mock.calls[0][0].where).toEqual({ email: 'c@x' })
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'creator', creatorId: 'c1' })
  })

  it('surfaces the CREATOR_CONNECT_ENABLED flag (false → client hides the section)', async () => {
    flagMock.mockReturnValue(false)
    sessionMock.mockResolvedValue({ user: { email: 'c@x' } })
    const body = await (await GET()).json()
    expect(body.enabled).toBe(false)
  })

  it('(c) no IDOR — a session with no creator profile gets an empty list, never another creator', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'consumer@x' } })
    db.creator.findUnique.mockResolvedValue(null)
    const body = await (await GET()).json()
    expect(body.payouts).toEqual([])
    expect(db.payout.findMany).not.toHaveBeenCalled()
  })
})
