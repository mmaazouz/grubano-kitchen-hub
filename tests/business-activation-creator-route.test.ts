import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/business/activation — ?role=creator (Agent 100) ───────────────────────────
// ?role=creator serves the creator checklist owner-scoped (Creator resolved by the SESSION
// email; a non-creator → empty). Signals are READ-ONLY (Creator entity: bio / payoutStatus —
// no money, no write). The restaurant path (no ?role) AND the affiliate branch (?role=affiliate)
// stay unchanged. The REAL activation engine is used; prisma/auth/roles/affiliate-account mocked.

const { db, session, roles, affAccount } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    creator:    { findUnique: vi.fn() },
    brand:      { findFirst: vi.fn() },
    restaurant: { findFirst: vi.fn() },
    menuItem:   { count: vi.fn() },
    affiliate:  { findUnique: vi.fn() },
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
  session.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'creator', status: 'active', emailVerifiedAt: new Date() })
  roles.readOperatorRoles.mockResolvedValue(['creator'])
  db.creator.findUnique.mockResolvedValue({ id: 'cr1', bio: null, payoutStatus: null }) // fresh creator
  affAccount.isAffiliateEnabled.mockReturnValue(true)
  affAccount.getAffiliateByOperator.mockResolvedValue(null)
  db.affiliate.findUnique.mockResolvedValue(null)
  db.brand.findFirst.mockResolvedValue(null)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
})
afterEach(() => { vi.clearAllMocks() })

describe('?role=creator — owner-scoped creator checklist', () => {
  it('fresh creator → 3 steps, profile current, payout deferred todo; owner from SESSION email', async () => {
    const res = await get('?role=creator')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('creator')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'creatorProfile', 'creatorPayout'])
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'creatorProfile').state).toBe('current')
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'creatorPayout').state).toBe('todo')
    expect(body.checklist.isDiscovery).toBe(true)
    // owner-scoping: Creator resolved by the SESSION email, never a client value.
    expect(db.creator.findUnique.mock.calls[0][0].where).toEqual({ email: 'c@x.fr' })
    // affiliate branch not consulted; restaurant reads not performed.
    expect(affAccount.getAffiliateByOperator).not.toHaveBeenCalled()
    expect(db.brand.findFirst).not.toHaveBeenCalled()
  })

  it('profile filled (bio) → profile done; payout-ready (Connect active) → journey complete', async () => {
    db.creator.findUnique.mockResolvedValue({ id: 'cr1', bio: 'Chef passionné', payoutStatus: 'active' })
    const body = await (await get('?role=creator')).json()
    expect(body.checklist.steps.every((s: { state: string }) => s.state === 'done')).toBe(true)
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('session user is NOT a creator → empty, non-discovery checklist (no cross-role leak)', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    const body = await (await get('?role=creator')).json()
    expect(body.checklist.steps).toEqual([])
    expect(body.checklist.isDiscovery).toBe(false)
  })

  it('no session → 401 (no creator read)', async () => {
    session.mockResolvedValue(null)
    expect((await get('?role=creator')).status).toBe(401)
    expect(db.creator.findUnique).not.toHaveBeenCalled()
  })
})

describe('existing branches unchanged', () => {
  it('no ?role → RESTAURANT path (creator helper not consulted)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', emailVerifiedAt: new Date() })
    roles.readOperatorRoles.mockResolvedValue(['restaurant'])
    const body = await (await get()).json()
    expect(body.role).toBe('restaurant')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(
      ['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'],
    )
    expect(db.creator.findUnique).not.toHaveBeenCalled()
    expect(db.brand.findFirst).toHaveBeenCalled()
  })

  it('?role=affiliate → AFFILIATE branch (creator helper not consulted)', async () => {
    roles.readOperatorRoles.mockResolvedValue(['affiliate'])
    affAccount.getAffiliateByOperator.mockResolvedValue({ id: 'aff1', operatorId: 'op1', status: 'active', referralCode: 'X', referralLinkSlug: 'x' })
    db.operator.findUnique.mockImplementation(({ where }: { where: { email?: string; id?: string } }) =>
      where.email
        ? Promise.resolve({ id: 'op1', role: 'affiliate', status: 'active', emailVerifiedAt: new Date() })
        : Promise.resolve({ affiliatePayoutStatus: null, registeredAddress: null, taxId: null, taxIdCountry: null, sellerType: null, dateOfBirth: null }))
    const body = await (await get('?role=affiliate')).json()
    expect(body.role).toBe('affiliate')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual(['account', 'affiliateLink', 'affiliateWithdraw'])
    expect(db.creator.findUnique).not.toHaveBeenCalled()
  })
})
