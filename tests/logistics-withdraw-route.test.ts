import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.3 ÉTAPE 5 — GET/POST /api/logistics/withdraw (LO7 feed + payout) ───────────────
// Owner-scoped (session email → LogisticsProfile). GET = the 4-state feed. POST = payout,
// gated LOGISTICS_PAYOUT_ENABLED, KYC-before-money, amount server-derived, payPartner reused.

const { auth, db, pay, connect, bal, thr } = vi.hoisted(() => ({
  auth:    { getServerSession: vi.fn() },
  db:      { logisticsProfile: { findUnique: vi.fn() }, operator: { findUnique: vi.fn() }, payout: { findMany: vi.fn() } },
  pay:     { isLogisticsPayoutEnabled: vi.fn(), payPartner: vi.fn() },
  connect: { isConnectOnboardingEnabled: vi.fn(), syncConnectStatus: vi.fn() },
  bal:     { computePartnerBalance: vi.fn() },
  thr:     { payoutMinCents: vi.fn(() => 2500) },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/creator-payout', () => ({ isLogisticsPayoutEnabled: pay.isLogisticsPayoutEnabled, payPartner: pay.payPartner }))
vi.mock('@/lib/connect-onboarding', () => ({ isConnectOnboardingEnabled: connect.isConnectOnboardingEnabled, syncConnectStatus: connect.syncConnectStatus }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: bal.computePartnerBalance }))
vi.mock('@/lib/payout-threshold', () => ({ payoutMinCents: thr.payoutMinCents }))

import { GET, POST } from '@/app/api/logistics/withdraw/route'

beforeEach(() => {
  vi.clearAllMocks()
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1', status: 'active', partnerType: 'independent', stripeAccountId: 'acct_l1', payoutStatus: 'active' })
  // DAC7 fiscal COMPLETE by default (so the happy-path payout tests reach payPartner).
  db.operator.findUnique.mockResolvedValue({ registeredAddress: '1 rue X', taxId: 'FR12345', taxIdCountry: 'FR', dateOfBirth: new Date('1990-01-01'), sellerType: 'individual' })
  db.payout.findMany.mockResolvedValue([])
  pay.isLogisticsPayoutEnabled.mockReturnValue(true)
  pay.payPartner.mockResolvedValue({ status: 'paid', role: 'logistics', refId: 'lp1', amountCents: 6480, stripeTransferId: 'tr_l1', resumed: false })
  connect.isConnectOnboardingEnabled.mockReturnValue(true)
  connect.syncConnectStatus.mockResolvedValue('active')
  bal.computePartnerBalance.mockResolvedValue({ availableCents: 6480, paidCents: 41200 })
})

describe('GET — the 4-state feed', () => {
  it('401 without a courier profile', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('returns available / threshold / connect status / flags / payouts (owner-scoped)', async () => {
    db.payout.findMany.mockResolvedValue([{ id: 'po1', amountCents: 18000, currency: 'eur', status: 'paid', createdAt: new Date('2026-06-28T00:00:00Z'), paidAt: new Date('2026-06-28T00:00:00Z'), stripeTransferId: 'tr_x' }])
    const json = await (await GET()).json()
    expect(json).toMatchObject({ payoutEnabled: true, connectEnabled: true, availableCents: 6480, thresholdCents: 2500, connectStatus: 'active', hasAccount: true })
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'logistics', logisticsProfileId: 'lp1' })
    expect(json.payouts[0]).toMatchObject({ id: 'po1', amountCents: 18000, status: 'paid' })
    // history refs are real Payout ids, never a fabricated « RET-… », and never an IBAN
    expect(json.payouts[0].stripeTransferId).toBe('tr_x')
  })
})

describe('POST — payout, gated + KYC-before-money', () => {
  it('rail OFF (LOGISTICS_PAYOUT_ENABLED false) → rail_disabled, NO profile/balance/payPartner touch', async () => {
    pay.isLogisticsPayoutEnabled.mockReturnValue(false)
    const json = await (await POST()).json()
    expect(json).toEqual({ status: 'rail_disabled', gated: true })
    expect(bal.computePartnerBalance).not.toHaveBeenCalled()
    expect(pay.payPartner).not.toHaveBeenCalled()
  })
  it('below threshold → below_threshold, no payPartner', async () => {
    bal.computePartnerBalance.mockResolvedValue({ availableCents: 1000, paidCents: 0 })
    const json = await (await POST()).json()
    expect(json).toMatchObject({ status: 'below_threshold', availableCents: 1000, thresholdCents: 2500 })
    expect(pay.payPartner).not.toHaveBeenCalled()
  })
  it('connect NOT active → kyc_required, no payPartner (KYC before money)', async () => {
    connect.syncConnectStatus.mockResolvedValue('pending')
    const json = await (await POST()).json()
    expect(json).toEqual({ status: 'kyc_required' })
    expect(pay.payPartner).not.toHaveBeenCalled()
  })
  it('DAC7 incomplete → fiscal_required, no payPartner (ÉTAPE 6, fiscal capture at 1st withdrawal)', async () => {
    db.operator.findUnique.mockResolvedValue({ registeredAddress: null, taxId: null, taxIdCountry: null, dateOfBirth: null, sellerType: null })
    const json = await (await POST()).json()
    expect(json).toEqual({ status: 'fiscal_required', fiscalComplete: false })
    expect(pay.payPartner).not.toHaveBeenCalled()
  })
  it('ready → payPartner(logistics, profileId) TEL QUEL, amount server-derived (body ignored)', async () => {
    const json = await (await POST()).json()
    expect(pay.payPartner).toHaveBeenCalledWith('logistics', 'lp1')
    expect(json).toEqual({ status: 'paid', amountCents: 6480, stripeTransferId: 'tr_l1' })
  })
  it('payPartner already_in_progress → in_progress (idempotence surfaced)', async () => {
    pay.payPartner.mockResolvedValue({ status: 'skipped', role: 'logistics', refId: 'lp1', reason: 'already_in_progress' })
    expect((await (await POST()).json())).toEqual({ status: 'in_progress' })
  })
})
