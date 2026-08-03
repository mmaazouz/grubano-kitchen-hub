import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── GET /api/admin/suppliers — ADMIN supplier console list (Agent 85) ──────────
// ADMIN-only (same guard as /api/admin/influencer-verifications: 401 no user, 403
// non-admin). READ-ONLY: returns each SupplierProfile's status + stored vetting /
// verification verdict (DISPLAYED, never recomputed). NON-MONEY: it touches ONLY
// supplierProfile.findMany and selects NO Stripe/Connect/payout field. The
// activate/suspend action is the SEPARATE, already-tested POST /api/supplier/admin/status.

const { db, session } = vi.hoisted(() => ({
  db: { supplierProfile: { findMany: vi.fn() } },
  session: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: session }))

import { GET } from '@/app/api/admin/suppliers/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.SUPPLIER_ENABLED = 'true' })
afterEach(() => { delete process.env.SUPPLIER_ENABLED })

const get = (url = 'http://x/api/admin/suppliers') => GET(new Request(url))

const ROWS = [
  { id: 'sp1', email: 'a@x.fr', companyName: 'Alpha', contactName: 'A', city: 'Paris',
    status: 'pending', vettingVerdict: 'doubt', vettingReason: 'nom différent',
    verificationStatus: 'review', siren: '123456789', officialName: 'ALPHA SAS', createdAt: new Date() },
]

beforeEach(() => {
  vi.clearAllMocks()
  db.supplierProfile.findMany.mockResolvedValue(ROWS)
})

describe('admin-only guard', () => {
  it('no session → 401, no read', async () => {
    session.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect(db.supplierProfile.findMany).not.toHaveBeenCalled()
  })

  it('non-admin (restaurant) → 403, no read', async () => {
    session.mockResolvedValue({ user: { role: 'restaurant' } })
    expect((await get()).status).toBe(403)
    expect(db.supplierProfile.findMany).not.toHaveBeenCalled()
  })

  it('admin via role → 200', async () => {
    session.mockResolvedValue({ user: { role: 'admin' } })
    expect((await get()).status).toBe(200)
  })

  it('admin via roles[] (multi-role) → 200', async () => {
    session.mockResolvedValue({ user: { role: 'restaurant', roles: ['restaurant', 'admin'] } })
    expect((await get()).status).toBe(200)
  })
})

describe('list — status + verdict (read-only)', () => {
  beforeEach(() => session.mockResolvedValue({ user: { role: 'admin' } }))

  it('returns suppliers with their status + stored verdict', async () => {
    const body = await (await get()).json()
    expect(body.ok).toBe(true)
    expect(body.suppliers[0]).toMatchObject({
      companyName: 'Alpha', status: 'pending', vettingVerdict: 'doubt',
      verificationStatus: 'review', siren: '123456789',
    })
  })

  it('⚠️ NON-MONEY: the select carries NO Stripe/Connect/payout field', async () => {
    await get()
    const select = db.supplierProfile.findMany.mock.calls[0][0].select
    expect(select.status).toBe(true)
    expect(select.vettingVerdict).toBe(true)
    expect(select).not.toHaveProperty('stripeAccountId')
    expect(select).not.toHaveProperty('payoutStatus')
    expect(select).not.toHaveProperty('stripeOnboardedAt')
  })
})

describe('?status filter', () => {
  beforeEach(() => session.mockResolvedValue({ user: { role: 'admin' } }))

  it('a valid status → where { status }', async () => {
    await get('http://x/api/admin/suppliers?status=active')
    expect(db.supplierProfile.findMany.mock.calls[0][0].where).toEqual({ status: 'active' })
  })

  it('an unknown status is ignored → where {}', async () => {
    await get('http://x/api/admin/suppliers?status=banished')
    expect(db.supplierProfile.findMany.mock.calls[0][0].where).toEqual({})
  })

  it('no status param → where {}', async () => {
    await get()
    expect(db.supplierProfile.findMany.mock.calls[0][0].where).toEqual({})
  })
})
