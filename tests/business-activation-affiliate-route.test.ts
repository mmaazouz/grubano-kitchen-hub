import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/business/activation — role-aware (Agent 98) ───────────────────────────────
// ?role=affiliate serves the affiliate checklist ONLY when the operator holds the affiliate
// role AND AFFILIATE_ENABLED is on; signals are READ-ONLY (Affiliate entity + stored operator
// payout/fiscal fields — no Stripe sync, no money). With NO role param the RESTAURANT path is
// unchanged. Owner-scoped: the operator comes from the SESSION email, never the request.
// The REAL activation engine is used; prisma/auth/roles/affiliate-account are mocked.

const { db, session, roles, affAccount } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    brand:      { findFirst: vi.fn() },
    restaurant: { findFirst: vi.fn() },
    menuItem:   { count: vi.fn() },
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
  session.mockResolvedValue({ user: { email: 'a@x.fr' } })
  db.operator.findUnique.mockImplementation(({ where }: { where: { email?: string; id?: string } }) => {
    if (where.email) return Promise.resolve({ id: 'op1', role: 'affiliate', status: 'active', emailVerifiedAt: new Date() })
    // 2nd read (affiliate payout/fiscal fields, by id) — not withdraw-ready by default.
    return Promise.resolve({ affiliatePayoutStatus: null, registeredAddress: null, taxId: null, taxIdCountry: null, sellerType: null, dateOfBirth: null })
  })
  roles.readOperatorRoles.mockResolvedValue(['affiliate'])
  affAccount.isAffiliateEnabled.mockReturnValue(true)
  affAccount.getAffiliateByOperator.mockResolvedValue({ id: 'aff1', operatorId: 'op1', referralCode: 'ALEX9F2K', referralLinkSlug: 'alex9f2k', status: 'active' })
  // restaurant-path reads (used only when no ?role param)
  db.brand.findFirst.mockResolvedValue(null)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
})
afterEach(() => { vi.clearAllMocks() })

describe('?role=affiliate — owner-scoped affiliate checklist', () => {
  it('serves the 3-step affiliate journey; withdraw deferred todo; owner from SESSION', async () => {
    const res = await get('?role=affiliate')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('affiliate')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'affiliateLink', 'affiliateWithdraw'])
    const w = body.checklist.steps.find((s: { id: string }) => s.id === 'affiliateWithdraw')
    expect(w.state).toBe('todo')
    expect(body.checklist.isDiscovery).toBe(true)

    // owner-scoping: operator resolved by SESSION email; affiliate read keyed off that id.
    expect(db.operator.findUnique.mock.calls[0][0].where).toEqual({ email: 'a@x.fr' })
    expect(affAccount.getAffiliateByOperator).toHaveBeenCalledWith('op1')
    // affiliate branch returns BEFORE any restaurant read.
    expect(db.brand.findFirst).not.toHaveBeenCalled()
    expect(db.menuItem.count).not.toHaveBeenCalled()
  })

  it('withdraw-ready (Connect active + DAC7 complete) → journey complete (guide will hide)', async () => {
    db.operator.findUnique.mockImplementation(({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) return Promise.resolve({ id: 'op1', role: 'affiliate', status: 'active', emailVerifiedAt: new Date() })
      return Promise.resolve({
        affiliatePayoutStatus: 'active', registeredAddress: '1 rue X', taxId: 'FR123',
        taxIdCountry: 'FR', sellerType: 'individual', dateOfBirth: new Date('1990-01-01'),
      })
    })
    const body = await (await get('?role=affiliate')).json()
    expect(body.checklist.steps.every((s: { state: string }) => s.state === 'done')).toBe(true)
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('AFFILIATE_ENABLED off → empty, non-discovery checklist (no guide)', async () => {
    affAccount.isAffiliateEnabled.mockReturnValue(false)
    const body = await (await get('?role=affiliate')).json()
    expect(body.checklist.steps).toEqual([])
    expect(body.checklist.isDiscovery).toBe(false)
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
  })

  it('operator without the affiliate role → empty checklist (no cross-role leak)', async () => {
    roles.readOperatorRoles.mockResolvedValue(['restaurant'])
    const body = await (await get('?role=affiliate')).json()
    expect(body.checklist.steps).toEqual([])
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
  })

  it('no session → 401 (no affiliate read)', async () => {
    session.mockResolvedValue(null)
    expect((await get('?role=affiliate')).status).toBe(401)
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
  })
})

describe('no ?role param — RESTAURANT path unchanged', () => {
  it('resolves the restaurant checklist exactly as before (affiliate branch not taken)', async () => {
    db.operator.findUnique.mockImplementation(({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) return Promise.resolve({ id: 'op1', role: 'restaurant', status: 'active', emailVerifiedAt: new Date() })
      return Promise.resolve(null)
    })
    roles.readOperatorRoles.mockResolvedValue(['restaurant'])
    const res = await get() // NO ?role
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('restaurant')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(
      ['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'],
    )
    // restaurant signals are read; the affiliate helper is never consulted.
    expect(db.brand.findFirst).toHaveBeenCalled()
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
  })
})
