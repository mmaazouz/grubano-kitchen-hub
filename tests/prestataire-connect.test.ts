import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Prestataire Stripe Connect lib (services P7, Agent 80) ────────────────────
// Double-flag gate (default closed); webhook persist scoped by account id; live status
// sync scoped to the session profile; onboarding creates a TEST Express account.
// ⚠️ ACCOUNT ONBOARDING ONLY — proves NO money method (charge/payout/transfer) is ever called.

const { db, stripe, account } = vi.hoisted(() => ({
  db: { prestataireProfile: { updateMany: vi.fn(), update: vi.fn() } },
  stripe: { getStripe: vi.fn(), createOnboardingLink: vi.fn(), retrieveAccount: vi.fn(), mapAccountStatus: vi.fn() },
  account: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({
  getStripe: stripe.getStripe,
  createOnboardingLink: stripe.createOnboardingLink,
  retrieveAccount: stripe.retrieveAccount,
  mapAccountStatus: stripe.mapAccountStatus,
}))
vi.mock('@/lib/prestataire-account', () => ({ isPrestataireEnabled: account }))

import {
  isPrestataireConnectEnabled, isPrestataireConnectLive,
  applyPrestataireAccountStatus, syncPrestatairePayoutStatus, startPrestataireOnboarding,
} from '@/lib/prestataire-connect'

// A Stripe stub exposing accounts.create plus the MONEY methods — so a test can assert
// the money methods are NEVER touched by the onboarding path.
function stripeStub() {
  const accountsCreate = vi.fn().mockResolvedValue({ id: 'acct_new' })
  const paymentIntentsCreate = vi.fn()
  const transfersCreate = vi.fn()
  const payoutsCreate = vi.fn()
  return {
    obj: {
      accounts: { create: accountsCreate },
      paymentIntents: { create: paymentIntentsCreate },
      transfers: { create: transfersCreate },
      payouts: { create: payoutsCreate },
    },
    accountsCreate, paymentIntentsCreate, transfersCreate, payoutsCreate,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.PRESTATAIRE_CONNECT_ENABLED
  account.mockReturnValue(true) // role flag ON by default in these unit tests
})

describe('isPrestataireConnectEnabled (connect gate — default CLOSED)', () => {
  it('false unless the flag is exactly "true"', () => {
    expect(isPrestataireConnectEnabled()).toBe(false)
    process.env.PRESTATAIRE_CONNECT_ENABLED = 'false'; expect(isPrestataireConnectEnabled()).toBe(false)
    process.env.PRESTATAIRE_CONNECT_ENABLED = '1'; expect(isPrestataireConnectEnabled()).toBe(false)
    process.env.PRESTATAIRE_CONNECT_ENABLED = 'true'; expect(isPrestataireConnectEnabled()).toBe(true)
  })
})

describe('isPrestataireConnectLive (DOUBLE flag — role AND connect)', () => {
  it('true ONLY when both PRESTATAIRE_ENABLED and PRESTATAIRE_CONNECT_ENABLED are on', () => {
    account.mockReturnValue(false); process.env.PRESTATAIRE_CONNECT_ENABLED = 'true'
    expect(isPrestataireConnectLive()).toBe(false)  // role off
    account.mockReturnValue(true); delete process.env.PRESTATAIRE_CONNECT_ENABLED
    expect(isPrestataireConnectLive()).toBe(false)  // connect off
    account.mockReturnValue(false); delete process.env.PRESTATAIRE_CONNECT_ENABLED
    expect(isPrestataireConnectLive()).toBe(false)  // both off
    account.mockReturnValue(true); process.env.PRESTATAIRE_CONNECT_ENABLED = 'true'
    expect(isPrestataireConnectLive()).toBe(true)   // both on
  })
})

describe('applyPrestataireAccountStatus (webhook persist, scoped by account id)', () => {
  it('updates the prestataire owning the account + stamps onboardedAt on active', async () => {
    db.prestataireProfile.updateMany.mockResolvedValue({ count: 1 })
    const n = await applyPrestataireAccountStatus('acct_1', 'active')
    expect(n).toBe(1)
    expect(db.prestataireProfile.updateMany.mock.calls[0][0]).toEqual({ where: { stripeAccountId: 'acct_1' }, data: { payoutStatus: 'active' } })
    expect(db.prestataireProfile.updateMany.mock.calls[1][0].where).toEqual({ stripeAccountId: 'acct_1', stripeOnboardedAt: null })
  })
  it('pending → single update, no onboardedAt stamp', async () => {
    db.prestataireProfile.updateMany.mockResolvedValue({ count: 1 })
    await applyPrestataireAccountStatus('acct_1', 'pending')
    expect(db.prestataireProfile.updateMany).toHaveBeenCalledTimes(1)
  })
  it('empty account id → no write, returns 0 (scoped — never a blanket update)', async () => {
    expect(await applyPrestataireAccountStatus('', 'active')).toBe(0)
    expect(db.prestataireProfile.updateMany).not.toHaveBeenCalled()
  })
})

describe('syncPrestatairePayoutStatus (live read + persist, session-scoped)', () => {
  it('no account → none (no Stripe call)', async () => {
    expect(await syncPrestatairePayoutStatus({ id: 'p1', stripeAccountId: null })).toBe('none')
    expect(stripe.retrieveAccount).not.toHaveBeenCalled()
  })
  it('with account → maps live status + persists to THIS profile only', async () => {
    stripe.retrieveAccount.mockResolvedValue({ id: 'acct_1' })
    stripe.mapAccountStatus.mockReturnValue('active')
    db.prestataireProfile.update.mockResolvedValue({})
    const s = await syncPrestatairePayoutStatus({ id: 'p1', stripeAccountId: 'acct_1' })
    expect(s).toBe('active')
    expect(db.prestataireProfile.update.mock.calls[0][0].where).toEqual({ id: 'p1' })
    expect(db.prestataireProfile.update.mock.calls[0][0].data.payoutStatus).toBe('active')
  })
  it('Stripe error → degrades to last-known status (never throws)', async () => {
    stripe.retrieveAccount.mockRejectedValue(new Error('stripe down'))
    expect(await syncPrestatairePayoutStatus({ id: 'p1', stripeAccountId: 'acct_1', payoutStatus: 'pending' })).toBe('pending')
  })
})

describe('startPrestataireOnboarding (TEST account + link, NO money)', () => {
  it('no account yet → creates a TEST Express account + writes stripeAccountId/pending + mints a link', async () => {
    const s = stripeStub()
    stripe.getStripe.mockReturnValue(s.obj)
    stripe.createOnboardingLink.mockResolvedValue({ url: 'https://connect.stripe.test/onb' })
    db.prestataireProfile.update.mockResolvedValue({})

    const out = await startPrestataireOnboarding({ id: 'p1', stripeAccountId: null }, { returnUrl: 'r', refreshUrl: 'f' })
    expect(out).toEqual({ url: 'https://connect.stripe.test/onb', accountId: 'acct_new' })

    // TEST Express account, tagged with the profile id.
    expect(s.accountsCreate).toHaveBeenCalledTimes(1)
    expect(s.accountsCreate.mock.calls[0][0]).toMatchObject({ type: 'express', country: 'FR', metadata: { prestataireProfileId: 'p1' } })
    // persisted onto the profile.
    expect(db.prestataireProfile.update.mock.calls[0][0]).toEqual({ where: { id: 'p1' }, data: { stripeAccountId: 'acct_new', payoutStatus: 'pending' } })
    // ⚠️ NO money method touched — onboarding only.
    expect(s.paymentIntentsCreate).not.toHaveBeenCalled()
    expect(s.transfersCreate).not.toHaveBeenCalled()
    expect(s.payoutsCreate).not.toHaveBeenCalled()
  })

  it('existing account → reuses it (no new account, no DB write), just a fresh link', async () => {
    const s = stripeStub()
    stripe.getStripe.mockReturnValue(s.obj)
    stripe.createOnboardingLink.mockResolvedValue({ url: 'https://connect.stripe.test/onb2' })

    const out = await startPrestataireOnboarding({ id: 'p1', stripeAccountId: 'acct_existing' }, { returnUrl: 'r', refreshUrl: 'f' })
    expect(out.accountId).toBe('acct_existing')
    expect(s.accountsCreate).not.toHaveBeenCalled()
    expect(db.prestataireProfile.update).not.toHaveBeenCalled()
    expect(stripe.createOnboardingLink).toHaveBeenCalledWith('acct_existing', 'f', 'r')
  })
})
