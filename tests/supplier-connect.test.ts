import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Supplier Stripe Connect lib (B2B Slice 5b, Agent 14) ──────────────────────
// Immatriculation gate (default closed); webhook persist scoped by account id;
// live status sync scoped to the session profile. No money moves.

const { db, stripe } = vi.hoisted(() => ({
  db: { supplierProfile: { updateMany: vi.fn(), update: vi.fn() } },
  stripe: { getStripe: vi.fn(), createOnboardingLink: vi.fn(), retrieveAccount: vi.fn(), mapAccountStatus: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({
  getStripe: stripe.getStripe,
  createOnboardingLink: stripe.createOnboardingLink,
  retrieveAccount: stripe.retrieveAccount,
  mapAccountStatus: stripe.mapAccountStatus,
}))

import { isSupplierConnectEnabled, applySupplierAccountStatus, syncSupplierPayoutStatus } from '@/lib/supplier-connect'

beforeEach(() => { vi.clearAllMocks(); delete process.env.SUPPLIER_CONNECT_ENABLED })

describe('isSupplierConnectEnabled (immatriculation gate — default CLOSED)', () => {
  it('false unless the flag is exactly "true"', () => {
    expect(isSupplierConnectEnabled()).toBe(false)
    process.env.SUPPLIER_CONNECT_ENABLED = 'false'; expect(isSupplierConnectEnabled()).toBe(false)
    process.env.SUPPLIER_CONNECT_ENABLED = '1'; expect(isSupplierConnectEnabled()).toBe(false)
    process.env.SUPPLIER_CONNECT_ENABLED = 'true'; expect(isSupplierConnectEnabled()).toBe(true)
  })
})

describe('applySupplierAccountStatus (webhook persist, scoped by account id)', () => {
  it('updates the supplier owning the account + stamps onboardedAt on active', async () => {
    db.supplierProfile.updateMany.mockResolvedValue({ count: 1 })
    const n = await applySupplierAccountStatus('acct_1', 'active')
    expect(n).toBe(1)
    expect(db.supplierProfile.updateMany.mock.calls[0][0]).toEqual({ where: { stripeAccountId: 'acct_1' }, data: { payoutStatus: 'active' } })
    expect(db.supplierProfile.updateMany.mock.calls[1][0].where).toEqual({ stripeAccountId: 'acct_1', stripeOnboardedAt: null })
  })
  it('pending → single update, no onboardedAt stamp', async () => {
    db.supplierProfile.updateMany.mockResolvedValue({ count: 1 })
    await applySupplierAccountStatus('acct_1', 'pending')
    expect(db.supplierProfile.updateMany).toHaveBeenCalledTimes(1)
  })
  it('empty account id → no write, returns 0', async () => {
    expect(await applySupplierAccountStatus('', 'active')).toBe(0)
    expect(db.supplierProfile.updateMany).not.toHaveBeenCalled()
  })
})

describe('syncSupplierPayoutStatus (live read + persist, session-scoped)', () => {
  it('no account → none (no Stripe call)', async () => {
    expect(await syncSupplierPayoutStatus({ id: 'p1', stripeAccountId: null })).toBe('none')
    expect(stripe.retrieveAccount).not.toHaveBeenCalled()
  })
  it('with account → maps live status + persists to THIS profile only', async () => {
    stripe.retrieveAccount.mockResolvedValue({ id: 'acct_1' })
    stripe.mapAccountStatus.mockReturnValue('active')
    db.supplierProfile.update.mockResolvedValue({})
    const s = await syncSupplierPayoutStatus({ id: 'p1', stripeAccountId: 'acct_1' })
    expect(s).toBe('active')
    expect(db.supplierProfile.update.mock.calls[0][0].where).toEqual({ id: 'p1' })
    expect(db.supplierProfile.update.mock.calls[0][0].data.payoutStatus).toBe('active')
  })
  it('Stripe error → degrades to last-known status (never throws)', async () => {
    stripe.retrieveAccount.mockRejectedValue(new Error('stripe down'))
    expect(await syncSupplierPayoutStatus({ id: 'p1', stripeAccountId: 'acct_1', payoutStatus: 'pending' })).toBe('pending')
  })
})
