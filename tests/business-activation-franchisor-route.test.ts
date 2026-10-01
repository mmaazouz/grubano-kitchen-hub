import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/business/activation — ?role=franchisor (Agent 105) ────────────────────────
// ?role=franchisor serves the franchisor checklist owner-scoped: the franchisor is OPERATOR-keyed
// (role string 'franchise'), resolved from the SESSION (operator id from the session email), served
// ONLY when the operator holds the 'franchise' role (else empty). Signals are READ-ONLY and
// MONEY-NEUTRAL (Operator.kybStatus / franchisePayoutStatus + a count of brands opened to
// franchising — NO royalty amount, no write, no rail). The restaurant path (no ?role) and the
// affiliate/creator/supplier/prestataire branches stay unchanged. The REAL engine is used.

const { db, session, roles, affAccount } = vi.hoisted(() => ({
  db: {
    operator:           { findUnique: vi.fn() },
    creator:            { findUnique: vi.fn() },
    supplierProfile:    { findUnique: vi.fn() },
    prestataireProfile: { findUnique: vi.fn() },
    brand:              { findFirst: vi.fn(), count: vi.fn() },
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
  session.mockResolvedValue({ user: { email: 'f@x.fr' } })
  // fresh franchisor: kyb not verified, no franchise payout. The single operator mock serves both
  // the GET prelude select (id/role/status) and franchisorActivation's select (kyb/payout).
  db.operator.findUnique.mockResolvedValue({
    id: 'op1', role: 'franchise', status: 'active', emailVerifiedAt: new Date(),
    kybStatus: null, franchisePayoutStatus: 'none',
  })
  roles.readOperatorRoles.mockResolvedValue(['franchise'])
  db.brand.count.mockResolvedValue(0)         // no brand opened to franchising yet
  affAccount.isAffiliateEnabled.mockReturnValue(true)
  affAccount.getAffiliateByOperator.mockResolvedValue(null)
  db.brand.findFirst.mockResolvedValue(null)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
})
afterEach(() => { vi.clearAllMocks() })

describe('?role=franchisor — owner-scoped franchisor checklist', () => {
  it('fresh franchisor → 4 steps, company current (no cta), franchise current+cta, payout deferred todo; owner-keyed', async () => {
    const res = await get('?role=franchisor')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('franchisor')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'franchisorCompany', 'franchisorFranchise', 'franchisorPayout'])
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'franchisorCompany').state).toBe('current')
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'franchisorCompany').ctaHref).toBeUndefined()
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'franchisorFranchise').state).toBe('current')
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'franchisorPayout').state).toBe('todo')
    expect(body.checklist.isDiscovery).toBe(true)
    // owner-scoped: brand count is filtered to THIS operator + openToFranchise (no royalty read)
    expect(db.brand.count.mock.calls[0][0].where).toEqual({ operatorId: 'op1', openToFranchise: true })
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
  })

  it('kyb verified + a franchisable brand + franchise payout active → journey complete', async () => {
    db.operator.findUnique.mockResolvedValue({
      id: 'op1', role: 'franchise', status: 'active', emailVerifiedAt: new Date(),
      kybStatus: 'verified', franchisePayoutStatus: 'active',
    })
    db.brand.count.mockResolvedValue(2)
    const body = await (await get('?role=franchisor')).json()
    expect(body.checklist.steps.every((s: { state: string }) => s.state === 'done')).toBe(true)
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('operator does NOT hold the franchise role → empty, non-discovery checklist (no cross-role leak, no brand read)', async () => {
    roles.readOperatorRoles.mockResolvedValue(['restaurant'])
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', emailVerifiedAt: new Date() })
    const body = await (await get('?role=franchisor')).json()
    expect(body.checklist.steps).toEqual([])
    expect(body.checklist.isDiscovery).toBe(false)
    expect(db.brand.count).not.toHaveBeenCalled()   // no franchise read for a non-franchisor
  })

  it('no session → 401 (no franchisor read)', async () => {
    session.mockResolvedValue(null)
    expect((await get('?role=franchisor')).status).toBe(401)
    expect(db.brand.count).not.toHaveBeenCalled()
  })
})

describe('existing branches unchanged by the franchisor addition', () => {
  it('no ?role → RESTAURANT path (franchisor helper not consulted)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', emailVerifiedAt: new Date() })
    roles.readOperatorRoles.mockResolvedValue(['restaurant'])
    const body = await (await get()).json()
    expect(body.role).toBe('restaurant')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'])
    expect(db.brand.count).not.toHaveBeenCalled()   // restaurant path uses brand.findFirst, not the franchisor count
  })

  it('?role=prestataire → PRESTATAIRE branch (franchisor helper not consulted)', async () => {
    roles.readOperatorRoles.mockResolvedValue(['prestataire'])
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'prestataire', status: 'active', emailVerifiedAt: new Date() })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', serviceCategories: [], verificationStatus: null, payoutStatus: 'none' })
    const body = await (await get('?role=prestataire')).json()
    expect(body.role).toBe('prestataire')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'prestataireProfile', 'prestataireCompany', 'prestatairePayout'])
    expect(db.brand.count).not.toHaveBeenCalled()
  })
})
