import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Brique D1 — connect-onboarding 'affiliate' beneficiary type (Agent 63) ────────────
// ADDITIVE: the affiliate attaches to the Operator's NEW affiliate* Connect fields,
// gated by AFFILIATE_CONNECT_ENABLED, with business_type='individual' (particulier).
// The existing creator/logistics/franchise behaviour is covered (unchanged) by
// tests/connect-onboarding.test.ts — here we assert the affiliate case + that the
// affiliate's business_type pin does NOT leak to other types.

const { stripeMock } = vi.hoisted(() => ({ stripeMock: { accounts: { create: vi.fn() } } }))
const { onboardingLinkMock, retrieveAccountMock, mapStatusMock } = vi.hoisted(() => ({
  onboardingLinkMock: vi.fn(), retrieveAccountMock: vi.fn(), mapStatusMock: vi.fn(),
}))
vi.mock('@/lib/stripe', () => ({
  getStripe: () => stripeMock,
  createOnboardingLink: onboardingLinkMock,
  retrieveAccount: retrieveAccountMock,
  mapAccountStatus: mapStatusMock,
}))

const { db } = vi.hoisted(() => ({
  db: { creator: { update: vi.fn() }, operator: { update: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { startConnectOnboarding, syncConnectStatus, isConnectOnboardingEnabled } from '@/lib/connect-onboarding'

const URLS = { returnUrl: 'https://app.grubano.com/x?connect=return', refreshUrl: 'https://app.grubano.com/x?connect=refresh' }

beforeEach(() => {
  vi.clearAllMocks()
  stripeMock.accounts.create.mockResolvedValue({ id: 'acct_new' })
  onboardingLinkMock.mockResolvedValue({ url: 'https://connect.stripe.test/onboard' })
})
afterEach(() => {
  delete process.env.AFFILIATE_CONNECT_ENABLED
  delete process.env.CREATOR_CONNECT_ENABLED
})

describe('isConnectOnboardingEnabled — affiliate flag, default OFF', () => {
  it('affiliate is OFF when AFFILIATE_CONNECT_ENABLED is unset, ON when "true"', () => {
    expect(isConnectOnboardingEnabled('affiliate')).toBe(false)
    process.env.AFFILIATE_CONNECT_ENABLED = 'true'
    expect(isConnectOnboardingEnabled('affiliate')).toBe(true)
    // independent of the other roles
    expect(isConnectOnboardingEnabled('creator')).toBe(false)
  })
})

describe('startConnectOnboarding(affiliate) — Operator affiliate* fields + individual', () => {
  it('creates an Express account (metadata.affiliateOperatorId, business_type=individual), persists on Operator', async () => {
    const res = await startConnectOnboarding('affiliate', { id: 'op1', accountId: null }, URLS)
    const params = stripeMock.accounts.create.mock.calls[0][0]
    expect(params).toMatchObject({ type: 'express', country: 'FR', business_type: 'individual', metadata: { affiliateOperatorId: 'op1' } })
    expect(db.operator.update).toHaveBeenCalledWith({ where: { id: 'op1' }, data: { affiliateStripeAccountId: 'acct_new', affiliatePayoutStatus: 'pending' } })
    expect(onboardingLinkMock).toHaveBeenCalledWith('acct_new', URLS.refreshUrl, URLS.returnUrl)
    expect(res).toEqual({ url: 'https://connect.stripe.test/onboard', accountId: 'acct_new' })
  })

  it('IDEMPOTENT — an existing accountId is reused (no 2nd Stripe account, no new-account write)', async () => {
    const res = await startConnectOnboarding('affiliate', { id: 'op1', accountId: 'acct_existing' }, URLS)
    expect(stripeMock.accounts.create).not.toHaveBeenCalled()
    expect(db.operator.update).not.toHaveBeenCalled()
    expect(res.accountId).toBe('acct_existing')
  })

  it('the business_type pin is affiliate-ONLY — creator stays default (no leak)', async () => {
    await startConnectOnboarding('creator', { id: 'c1', accountId: null }, URLS)
    expect(stripeMock.accounts.create.mock.calls[0][0]).not.toHaveProperty('business_type')
  })
})

describe('syncConnectStatus(affiliate) — persists onto affiliate* fields', () => {
  it('active → affiliatePayoutStatus=active + affiliateStripeOnboardedAt stamped', async () => {
    retrieveAccountMock.mockResolvedValue({ id: 'acct_x' })
    mapStatusMock.mockReturnValue('active')
    const s = await syncConnectStatus('affiliate', { id: 'op1', accountId: 'acct_x', status: 'pending' })
    expect(s).toBe('active')
    const data = db.operator.update.mock.calls[0][0].data
    expect(data.affiliatePayoutStatus).toBe('active')
    expect(data.affiliateStripeOnboardedAt).toBeInstanceOf(Date)
  })

  it('pending → status persisted, NO onboardedAt stamp', async () => {
    retrieveAccountMock.mockResolvedValue({ id: 'acct_x' })
    mapStatusMock.mockReturnValue('pending')
    await syncConnectStatus('affiliate', { id: 'op1', accountId: 'acct_x', status: null })
    const data = db.operator.update.mock.calls[0][0].data
    expect(data.affiliatePayoutStatus).toBe('pending')
    expect(data).not.toHaveProperty('affiliateStripeOnboardedAt')
  })
})
