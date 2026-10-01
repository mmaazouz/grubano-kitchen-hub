import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── P4.1 — Connect onboarding routes (Agent 37) ──────────────────────────────
// Locks the security wiring of the 3 owner-scoped routes: flag default OFF → 403,
// no session → 401 (no onboarding), flag ON + session → mints the link, and the
// franchise role gate (operator must hold 'franchise'). The onboarding helper is
// mocked (no Stripe), so these tests assert ONLY auth/flag/wiring.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: {
    creator:          { findUnique: vi.fn() },
    logisticsProfile: { findUnique: vi.fn() },
    operator:         { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { flagMock, startMock, syncMock } = vi.hoisted(() => ({ flagMock: vi.fn(), startMock: vi.fn(), syncMock: vi.fn() }))
vi.mock('@/lib/connect-onboarding', () => ({
  isConnectOnboardingEnabled: flagMock,
  startConnectOnboarding: startMock,
  syncConnectStatus: syncMock,
}))

const { rolesMock } = vi.hoisted(() => ({ rolesMock: vi.fn() }))
vi.mock('@/lib/operator-roles', () => ({ readOperatorRoles: rolesMock }))

import { POST as creatorPOST } from '@/app/api/creator/connect/route'
import { POST as logisticsPOST } from '@/app/api/logistics/connect/route'
import { POST as franchisePOST } from '@/app/api/franchise/connect/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true'; process.env.FRANCHISE_ENABLED = 'true'; process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED; delete process.env.FRANCHISE_ENABLED; delete process.env.LOGISTICS_ENABLED })

const post = (fn: (req: Request) => Promise<Response>, path: string) =>
  fn(new Request(`https://app.grubano.com${path}`, { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  startMock.mockResolvedValue({ url: 'https://connect.stripe.test/onboard', accountId: 'acct_1' })
})

describe('POST /api/creator/connect', () => {
  it('(a) flag OFF → 403 gated, BEFORE any DB read or onboarding call', async () => {
    flagMock.mockReturnValue(false)
    const res = await post(creatorPOST, '/api/creator/connect')
    expect(res.status).toBe(403)
    expect(startMock).not.toHaveBeenCalled()
    expect(db.creator.findUnique).not.toHaveBeenCalled() // 403 fires before any DB access
  })

  it('(d) flag ON + no session → 401, no onboarding', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue(null)
    const res = await post(creatorPOST, '/api/creator/connect')
    expect(res.status).toBe(401)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('(b) flag ON + session creator → 200 + link, onboarding scoped to the session creator', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue({ user: { email: 'c@x' } })
    db.creator.findUnique.mockResolvedValue({ id: 'c1', stripeAccountId: null, payoutStatus: null })
    const res = await post(creatorPOST, '/api/creator/connect')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ url: 'https://connect.stripe.test/onboard' })
    expect(startMock).toHaveBeenCalledWith('creator', { id: 'c1', accountId: null }, expect.any(Object))
  })
})

describe('POST /api/logistics/connect', () => {
  it('flag OFF → 403 gated', async () => {
    flagMock.mockReturnValue(false)
    const res = await post(logisticsPOST, '/api/logistics/connect')
    expect(res.status).toBe(403)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('flag ON + ACTIVE session profile → 200, scoped + business_type from partnerType (P4.3 ÉTAPE 5)', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue({ user: { email: 'l@x' } })
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'l1', status: 'active', stripeAccountId: 'acct_l', payoutStatus: 'pending', partnerType: 'independent' })
    const res = await post(logisticsPOST, '/api/logistics/connect')
    expect(res.status).toBe(200)
    // independent → individual business_type
    expect(startMock).toHaveBeenCalledWith('logistics', { id: 'l1', accountId: 'acct_l', businessType: 'individual' }, expect.any(Object))
  })

  it('flag ON + company partnerType → business_type=company', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue({ user: { email: 'l@x' } })
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'l1', status: 'active', stripeAccountId: 'acct_l', payoutStatus: 'pending', partnerType: 'company' })
    const res = await post(logisticsPOST, '/api/logistics/connect')
    expect(res.status).toBe(200)
    expect(startMock).toHaveBeenCalledWith('logistics', { id: 'l1', accountId: 'acct_l', businessType: 'company' }, expect.any(Object))
  })

  it('flag ON + NON-active profile → 403, no onboarding (mirror of the supplier status gate)', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue({ user: { email: 'l@x' } })
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'l1', status: 'pending', stripeAccountId: null, payoutStatus: null })
    const res = await post(logisticsPOST, '/api/logistics/connect')
    expect(res.status).toBe(403)
    expect(startMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/franchise/connect', () => {
  it('flag OFF → 403 gated', async () => {
    flagMock.mockReturnValue(false)
    const res = await post(franchisePOST, '/api/franchise/connect')
    expect(res.status).toBe(403)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('flag ON + operator WITHOUT franchise role → 401, no onboarding (role gate)', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue({ user: { id: 'op1' } })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', franchiseStripeAccountId: null })
    rolesMock.mockResolvedValue(['restaurant'])
    const res = await post(franchisePOST, '/api/franchise/connect')
    expect(res.status).toBe(401)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('flag ON + franchise role but NON-active account → 403, no onboarding', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue({ user: { id: 'op1' } })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'franchise', status: 'suspended', franchiseStripeAccountId: null })
    rolesMock.mockResolvedValue(['restaurant', 'franchise'])
    const res = await post(franchisePOST, '/api/franchise/connect')
    expect(res.status).toBe(403)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('flag ON + ACTIVE operator WITH franchise role → 200, scoped to the franchise operator', async () => {
    flagMock.mockReturnValue(true)
    sessionMock.mockResolvedValue({ user: { id: 'op1' } })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', franchiseStripeAccountId: null })
    rolesMock.mockResolvedValue(['restaurant', 'franchise'])
    const res = await post(franchisePOST, '/api/franchise/connect')
    expect(res.status).toBe(200)
    expect(startMock).toHaveBeenCalledWith('franchise', { id: 'op1', accountId: null }, expect.any(Object))
  })
})
