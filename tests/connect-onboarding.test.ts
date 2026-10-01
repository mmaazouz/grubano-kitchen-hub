import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.1 — Connect onboarding helper (Agent 37) ──────────────────────────────
// Locks the generic mirror of startSupplierOnboarding: per-role kill-switch
// (default OFF), Express account creation tagged per role, idempotent reuse (no
// 2nd Stripe account), and per-entity status persistence. Stripe + Prisma mocked.

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
  db: {
    creator:          { update: vi.fn() },
    logisticsProfile: { update: vi.fn() },
    operator:         { update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  startConnectOnboarding,
  syncConnectStatus,
  isConnectOnboardingEnabled,
} from '@/lib/connect-onboarding'

const URLS = { returnUrl: 'https://app.grubano.com/x?connect=return', refreshUrl: 'https://app.grubano.com/x?connect=refresh' }

beforeEach(() => {
  vi.clearAllMocks()
  stripeMock.accounts.create.mockResolvedValue({ id: 'acct_new' })
  onboardingLinkMock.mockResolvedValue({ url: 'https://connect.stripe.test/onboard' })
})

afterEach(() => {
  delete process.env.CREATOR_CONNECT_ENABLED
  delete process.env.LOGISTICS_CONNECT_ENABLED
  delete process.env.FRANCHISE_CONNECT_ENABLED
})

describe('isConnectOnboardingEnabled — per-role kill-switch, default OFF', () => {
  it('every role is OFF when its env var is unset', () => {
    expect(isConnectOnboardingEnabled('creator')).toBe(false)
    expect(isConnectOnboardingEnabled('logistics')).toBe(false)
    expect(isConnectOnboardingEnabled('franchise')).toBe(false)
  })
  it('only the role whose flag is "true" turns ON (independent flags)', () => {
    process.env.CREATOR_CONNECT_ENABLED = 'true'
    expect(isConnectOnboardingEnabled('creator')).toBe(true)
    expect(isConnectOnboardingEnabled('logistics')).toBe(false)
    expect(isConnectOnboardingEnabled('franchise')).toBe(false)
  })
})

describe('startConnectOnboarding — create + persist on the right entity', () => {
  it('creator without an account → creates Express (metadata.creatorId), stores on Creator, returns link', async () => {
    const res = await startConnectOnboarding('creator', { id: 'c1', accountId: null }, URLS)
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1)
    expect(stripeMock.accounts.create.mock.calls[0][0]).toMatchObject({ type: 'express', country: 'FR', metadata: { creatorId: 'c1' } })
    expect(db.creator.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { stripeAccountId: 'acct_new', payoutStatus: 'pending' } })
    expect(onboardingLinkMock).toHaveBeenCalledWith('acct_new', URLS.refreshUrl, URLS.returnUrl)
    expect(res).toEqual({ url: 'https://connect.stripe.test/onboard', accountId: 'acct_new' })
  })

  it('logistics → stores on LogisticsProfile (metadata.logisticsProfileId)', async () => {
    await startConnectOnboarding('logistics', { id: 'l1', accountId: null }, URLS)
    expect(stripeMock.accounts.create.mock.calls[0][0].metadata).toEqual({ logisticsProfileId: 'l1' })
    expect(db.logisticsProfile.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { stripeAccountId: 'acct_new', payoutStatus: 'pending' } })
  })

  it('franchise → stores on Operator franchise* fields (metadata.franchiseOperatorId)', async () => {
    await startConnectOnboarding('franchise', { id: 'op1', accountId: null }, URLS)
    expect(stripeMock.accounts.create.mock.calls[0][0].metadata).toEqual({ franchiseOperatorId: 'op1' })
    expect(db.operator.update).toHaveBeenCalledWith({ where: { id: 'op1' }, data: { franchiseStripeAccountId: 'acct_new', franchisePayoutStatus: 'pending' } })
  })

  it('IDEMPOTENT — an existing accountId is reused: NO 2nd Stripe account, NO new-account write', async () => {
    const res = await startConnectOnboarding('creator', { id: 'c1', accountId: 'acct_existing' }, URLS)
    expect(stripeMock.accounts.create).not.toHaveBeenCalled()
    expect(db.creator.update).not.toHaveBeenCalled()
    expect(onboardingLinkMock).toHaveBeenCalledWith('acct_existing', URLS.refreshUrl, URLS.returnUrl)
    expect(res.accountId).toBe('acct_existing')
  })
})

describe('syncConnectStatus — on-demand status, per entity', () => {
  it('no account → "none", no Stripe read', async () => {
    const s = await syncConnectStatus('creator', { id: 'c1', accountId: null })
    expect(s).toBe('none')
    expect(retrieveAccountMock).not.toHaveBeenCalled()
  })

  it('active account → persists status + stamps onboardedAt on the entity', async () => {
    retrieveAccountMock.mockResolvedValue({ id: 'acct_x' })
    mapStatusMock.mockReturnValue('active')
    const s = await syncConnectStatus('logistics', { id: 'l1', accountId: 'acct_x', status: 'pending' })
    expect(s).toBe('active')
    const data = db.logisticsProfile.update.mock.calls[0][0].data
    expect(data.payoutStatus).toBe('active')
    expect(data.stripeOnboardedAt).toBeInstanceOf(Date)
  })

  it('pending account → persists status, NO onboardedAt stamp', async () => {
    retrieveAccountMock.mockResolvedValue({ id: 'acct_x' })
    mapStatusMock.mockReturnValue('pending')
    await syncConnectStatus('franchise', { id: 'op1', accountId: 'acct_x', status: null })
    const data = db.operator.update.mock.calls[0][0].data
    expect(data.franchisePayoutStatus).toBe('pending')
    expect(data).not.toHaveProperty('franchiseStripeOnboardedAt')
  })

  it('tolerant — a Stripe hiccup degrades to the last-known status, never throws', async () => {
    retrieveAccountMock.mockRejectedValue(new Error('stripe down'))
    const s = await syncConnectStatus('creator', { id: 'c1', accountId: 'acct_x', status: 'active' })
    expect(s).toBe('active')
    expect(db.creator.update).not.toHaveBeenCalled()
  })
})
