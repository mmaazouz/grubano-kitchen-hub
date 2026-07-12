import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST/GET /api/affiliate/connect — affiliate Connect onboarding (Brique D2, Agent 64) ─
// Owner-scoped (SESSION operator id), gated by AFFILIATE_ENABLED + AFFILIATE_CONNECT_ENABLED.
// REUSES connect-onboarding TEL QUEL (type 'affiliate'). No money here.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { affEnabledMock, getAffMock } = vi.hoisted(() => ({ affEnabledMock: vi.fn(), getAffMock: vi.fn() }))
vi.mock('@/lib/affiliate-account', () => ({ isAffiliateEnabled: affEnabledMock, getAffiliateByOperator: getAffMock }))

const { connEnabledMock, startOnboardMock, syncMock } = vi.hoisted(() => ({ connEnabledMock: vi.fn(), startOnboardMock: vi.fn(), syncMock: vi.fn() }))
vi.mock('@/lib/connect-onboarding', () => ({
  isConnectOnboardingEnabled: connEnabledMock,
  startConnectOnboarding: startOnboardMock,
  syncConnectStatus: syncMock,
}))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST, GET } from '@/app/api/affiliate/connect/route'

const post = () => POST(new Request('https://app.grubano.com/api/affiliate/connect', { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  affEnabledMock.mockReturnValue(true)
  connEnabledMock.mockReturnValue(true)
  sessionMock.mockResolvedValue({ user: { id: 'op1' } })
  getAffMock.mockResolvedValue({ id: 'aff1', operatorId: 'op1', referralCode: 'X', referralLinkSlug: 'x', status: 'active' })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', affiliateStripeAccountId: null, affiliatePayoutStatus: null })
  startOnboardMock.mockResolvedValue({ url: 'https://connect.stripe.test/onboard', accountId: 'acct_new' })
  syncMock.mockResolvedValue('pending')
})

describe('flag gate', () => {
  it('AFFILIATE_ENABLED OFF → 404', async () => {
    affEnabledMock.mockReturnValue(false)
    expect((await post()).status).toBe(404)
    expect(startOnboardMock).not.toHaveBeenCalled()
  })
  it('AFFILIATE_CONNECT_ENABLED OFF → 404', async () => {
    connEnabledMock.mockReturnValue(false)
    expect((await post()).status).toBe(404)
  })
})

describe('owner-scoping', () => {
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })
  it('not an affiliate → 401', async () => {
    getAffMock.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })
})

describe('POST — starts the affiliate onboarding', () => {
  it('calls startConnectOnboarding("affiliate", session operator + its account) and returns the link', async () => {
    const out = await (await post()).json()
    expect(startOnboardMock).toHaveBeenCalledTimes(1)
    const [type, entity] = startOnboardMock.mock.calls[0]
    expect(type).toBe('affiliate')
    expect(entity).toEqual({ id: 'op1', accountId: null })
    expect(out).toEqual({ url: 'https://connect.stripe.test/onboard', accountId: 'acct_new' })
  })
})

describe('GET — reflects the live status', () => {
  it('syncs the affiliate Connect status for the session operator', async () => {
    const out = await (await GET()).json()
    expect(syncMock).toHaveBeenCalledWith('affiliate', { id: 'op1', accountId: null, status: null })
    expect(out).toEqual({ status: 'pending', hasAccount: false })
  })
})
