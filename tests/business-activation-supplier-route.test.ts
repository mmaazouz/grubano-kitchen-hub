import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/business/activation — ?role=supplier (Agent 103) ──────────────────────────
// ?role=supplier serves the supplier checklist owner-scoped (SupplierProfile resolved by the
// SESSION email; a non-supplier → empty). Signals are READ-ONLY (SupplierProfile:
// verificationStatus / catalogue count / payoutStatus — no money, no write). The restaurant path
// (no ?role) and the affiliate/creator branches stay unchanged. The REAL activation engine is
// used; prisma/auth/roles/affiliate-account are mocked.

const { db, session, roles, affAccount } = vi.hoisted(() => ({
  db: {
    operator:        { findUnique: vi.fn() },
    creator:         { findUnique: vi.fn() },
    supplierProfile: { findUnique: vi.fn() },
    brand:           { findFirst: vi.fn() },
    restaurant:      { findFirst: vi.fn() },
    menuItem:        { count: vi.fn() },
  },
  session: vi.fn(),
  roles: { readOperatorRoles: vi.fn() },
  affAccount: { isAffiliateEnabled: vi.fn(), getAffiliateByOperator: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/operator-roles', () => roles)
vi.mock('@/lib/affiliate-account', () => affAccount)

import { GET } from '@/app/api/business/activation/route'

const get = (qs = '') => GET(new Request(`http://x/api/business/activation${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { email: 's@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'supplier', status: 'active', emailVerifiedAt: new Date() })
  roles.readOperatorRoles.mockResolvedValue(['supplier'])
  // fresh supplier: unverified, empty catalogue, no payout
  db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', verificationStatus: null, payoutStatus: 'none', _count: { catalogItems: 0 } })
  affAccount.isAffiliateEnabled.mockReturnValue(true)
  affAccount.getAffiliateByOperator.mockResolvedValue(null)
  db.brand.findFirst.mockResolvedValue(null)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
})
afterEach(() => { vi.clearAllMocks() })

describe('?role=supplier — owner-scoped supplier checklist', () => {
  it('fresh supplier → 4 steps, company current, catalogue locked, payout deferred todo; owner from SESSION email', async () => {
    const res = await get('?role=supplier')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('supplier')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'supplierCompany', 'supplierCatalogue', 'supplierPayout'])
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'supplierCompany').state).toBe('current')
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'supplierCatalogue').state).toBe('locked')
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'supplierPayout').state).toBe('todo')
    expect(body.checklist.isDiscovery).toBe(true)
    expect(db.supplierProfile.findUnique.mock.calls[0][0].where).toEqual({ email: 's@x.fr' }) // owner-scoped
    expect(db.brand.findFirst).not.toHaveBeenCalled()   // affiliate/restaurant paths not taken
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
  })

  it('verified + catalogue + payout active → journey complete', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', verificationStatus: 'verified', payoutStatus: 'active', _count: { catalogItems: 3 } })
    const body = await (await get('?role=supplier')).json()
    expect(body.checklist.steps.every((s: { state: string }) => s.state === 'done')).toBe(true)
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('session user is NOT a supplier → empty, non-discovery checklist (no cross-role leak)', async () => {
    db.supplierProfile.findUnique.mockResolvedValue(null)
    const body = await (await get('?role=supplier')).json()
    expect(body.checklist.steps).toEqual([])
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('no session → 401 (no supplier read)', async () => {
    session.mockResolvedValue(null)
    expect((await get('?role=supplier')).status).toBe(401)
    expect(db.supplierProfile.findUnique).not.toHaveBeenCalled()
  })
})

describe('existing branches unchanged by the supplier addition', () => {
  it('no ?role → RESTAURANT path (supplier helper not consulted)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', emailVerifiedAt: new Date() })
    roles.readOperatorRoles.mockResolvedValue(['restaurant'])
    const body = await (await get()).json()
    expect(body.role).toBe('restaurant')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'])
    expect(db.supplierProfile.findUnique).not.toHaveBeenCalled()
  })

  it('?role=creator → CREATOR branch (supplier helper not consulted)', async () => {
    roles.readOperatorRoles.mockResolvedValue(['creator'])
    db.creator.findUnique.mockResolvedValue({ id: 'cr1', bio: null, payoutStatus: null })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'creator', status: 'active', emailVerifiedAt: new Date() })
    const body = await (await get('?role=creator')).json()
    expect(body.role).toBe('creator')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'creatorProfile', 'creatorPayout'])
    expect(db.supplierProfile.findUnique).not.toHaveBeenCalled()
  })
})
