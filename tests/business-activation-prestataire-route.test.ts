import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/business/activation — ?role=prestataire (Agent 104) ───────────────────────
// ?role=prestataire serves the prestataire checklist owner-scoped (PrestataireProfile resolved by
// the SESSION email; a non-prestataire → empty). Signals are READ-ONLY (PrestataireProfile:
// serviceCategories / verificationStatus / payoutStatus — no money, no write). The restaurant path
// (no ?role) and the affiliate/creator/supplier branches stay unchanged. The REAL activation engine
// is used; prisma/auth/roles/affiliate-account are mocked.

const { db, session, roles, affAccount } = vi.hoisted(() => ({
  db: {
    operator:           { findUnique: vi.fn() },
    creator:            { findUnique: vi.fn() },
    supplierProfile:    { findUnique: vi.fn() },
    prestataireProfile: { findUnique: vi.fn() },
    brand:              { findFirst: vi.fn() },
    restaurant:         { findFirst: vi.fn() },
    menuItem:           { count: vi.fn() },
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
  session.mockResolvedValue({ user: { email: 'p@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'prestataire', status: 'active', emailVerifiedAt: new Date() })
  roles.readOperatorRoles.mockResolvedValue(['prestataire'])
  // fresh prestataire: no service category, unverified, no payout
  db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', serviceCategories: [], verificationStatus: null, payoutStatus: 'none' })
  affAccount.isAffiliateEnabled.mockReturnValue(true)
  affAccount.getAffiliateByOperator.mockResolvedValue(null)
  db.brand.findFirst.mockResolvedValue(null)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
})
afterEach(() => { vi.clearAllMocks() })

describe('?role=prestataire — owner-scoped prestataire checklist', () => {
  it('fresh prestataire → 4 steps, profile current, company todo (not locked), payout deferred todo; owner from SESSION email', async () => {
    const res = await get('?role=prestataire')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('prestataire')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'prestataireProfile', 'prestataireCompany', 'prestatairePayout'])
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'prestataireProfile').state).toBe('current')
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'prestataireCompany').state).toBe('todo')
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'prestatairePayout').state).toBe('todo')
    expect(body.checklist.isDiscovery).toBe(true)
    expect(db.prestataireProfile.findUnique.mock.calls[0][0].where).toEqual({ email: 'p@x.fr' }) // owner-scoped
    expect(db.brand.findFirst).not.toHaveBeenCalled()   // affiliate/restaurant paths not taken
    expect(db.supplierProfile.findUnique).not.toHaveBeenCalled()
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
  })

  it('profile (≥1 category) + company verified + payout active → journey complete', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', serviceCategories: ['plumbing'], verificationStatus: 'verified', payoutStatus: 'active' })
    const body = await (await get('?role=prestataire')).json()
    expect(body.checklist.steps.every((s: { state: string }) => s.state === 'done')).toBe(true)
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('non-array serviceCategories is treated as empty (defensive) → profile still current', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', serviceCategories: null, verificationStatus: null, payoutStatus: 'none' })
    const body = await (await get('?role=prestataire')).json()
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'prestataireProfile').state).toBe('current')
  })

  it('session user is NOT a prestataire → empty, non-discovery checklist (no cross-role leak)', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue(null)
    const body = await (await get('?role=prestataire')).json()
    expect(body.checklist.steps).toEqual([])
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('no session → 401 (no prestataire read)', async () => {
    session.mockResolvedValue(null)
    expect((await get('?role=prestataire')).status).toBe(401)
    expect(db.prestataireProfile.findUnique).not.toHaveBeenCalled()
  })
})

describe('existing branches unchanged by the prestataire addition', () => {
  it('no ?role → RESTAURANT path (prestataire helper not consulted)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', emailVerifiedAt: new Date() })
    roles.readOperatorRoles.mockResolvedValue(['restaurant'])
    const body = await (await get()).json()
    expect(body.role).toBe('restaurant')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'])
    expect(db.prestataireProfile.findUnique).not.toHaveBeenCalled()
  })

  it('?role=supplier → SUPPLIER branch (prestataire helper not consulted)', async () => {
    roles.readOperatorRoles.mockResolvedValue(['supplier'])
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'supplier', status: 'active', emailVerifiedAt: new Date() })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', verificationStatus: null, payoutStatus: 'none', _count: { catalogItems: 0 } })
    const body = await (await get('?role=supplier')).json()
    expect(body.role).toBe('supplier')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'supplierCompany', 'supplierCatalogue', 'supplierPayout'])
    expect(db.prestataireProfile.findUnique).not.toHaveBeenCalled()
  })

  it('?role=creator → CREATOR branch (prestataire helper not consulted)', async () => {
    roles.readOperatorRoles.mockResolvedValue(['creator'])
    db.creator.findUnique.mockResolvedValue({ id: 'cr1', bio: null, payoutStatus: null })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'creator', status: 'active', emailVerifiedAt: new Date() })
    const body = await (await get('?role=creator')).json()
    expect(body.role).toBe('creator')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'creatorProfile', 'creatorPayout'])
    expect(db.prestataireProfile.findUnique).not.toHaveBeenCalled()
  })
})
