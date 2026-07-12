import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST/GET /api/affiliate/withdraw — affiliate self-service payout (Brique D2, Agent 64) ─
// MONEY-MOVEMENT orchestration. Proves: flags gate OFF (404); below-threshold refuses;
// KYC-before-money (no transfer without active Connect); fiscal capture gate; payPartner
// is called TEL QUEL with ('affiliate', operatorId) and NO client amount; idempotence
// surfaced; owner-scoped to the SESSION operator (no IDOR).

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { affEnabledMock, getAffMock } = vi.hoisted(() => ({ affEnabledMock: vi.fn(), getAffMock: vi.fn() }))
vi.mock('@/lib/affiliate-account', () => ({ isAffiliateEnabled: affEnabledMock, getAffiliateByOperator: getAffMock }))

const { connEnabledMock, payPartnerMock } = vi.hoisted(() => ({ connEnabledMock: vi.fn(), payPartnerMock: vi.fn() }))
vi.mock('@/lib/creator-payout', () => ({ isAffiliateConnectEnabled: connEnabledMock, payPartner: payPartnerMock }))

const { startOnboardMock, syncMock } = vi.hoisted(() => ({ startOnboardMock: vi.fn(), syncMock: vi.fn() }))
vi.mock('@/lib/connect-onboarding', () => ({ startConnectOnboarding: startOnboardMock, syncConnectStatus: syncMock }))

const { balMock } = vi.hoisted(() => ({ balMock: vi.fn() }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: balMock }))

const { thresholdMock } = vi.hoisted(() => ({ thresholdMock: vi.fn() }))
vi.mock('@/lib/payout-threshold', () => ({ payoutMinCents: thresholdMock }))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() }, payout: { findMany: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST, GET } from '@/app/api/affiliate/withdraw/route'

const OP_COMPLETE = {
  id: 'op1', affiliateStripeAccountId: 'acct_a1', affiliatePayoutStatus: 'active',
  registeredAddress: '1 rue', taxId: 'FR123', taxIdCountry: 'FR', dateOfBirth: new Date('1990-01-01'), sellerType: 'individual',
}
const post = (body: unknown = {}) =>
  POST(new Request('https://app.grubano.com/api/affiliate/withdraw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  affEnabledMock.mockReturnValue(true)
  connEnabledMock.mockReturnValue(true)
  sessionMock.mockResolvedValue({ user: { id: 'op1' } })
  getAffMock.mockResolvedValue({ id: 'aff1', operatorId: 'op1', referralCode: 'X', referralLinkSlug: 'x', status: 'active' })
  db.operator.findUnique.mockResolvedValue(OP_COMPLETE)
  db.payout.findMany.mockResolvedValue([])
  balMock.mockResolvedValue({ role: 'affiliate', refId: 'op1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
  thresholdMock.mockReturnValue(2500)
  syncMock.mockResolvedValue('active')
  startOnboardMock.mockResolvedValue({ url: 'https://connect.stripe.test/onboard', accountId: 'acct_a1' })
  payPartnerMock.mockResolvedValue({ status: 'paid', role: 'affiliate', refId: 'op1', amountCents: 5000, stripeTransferId: 'tr_a1', resumed: false })
})

describe('(f) flag gate — byte-identical OFF', () => {
  it('AFFILIATE_ENABLED OFF → 404, no balance/payout work', async () => {
    affEnabledMock.mockReturnValue(false)
    const res = await post()
    expect(res.status).toBe(404)
    expect(balMock).not.toHaveBeenCalled()
    expect(payPartnerMock).not.toHaveBeenCalled()
  })
  it('AFFILIATE_CONNECT_ENABLED OFF → 404', async () => {
    connEnabledMock.mockReturnValue(false)
    expect((await post()).status).toBe(404)
    expect(payPartnerMock).not.toHaveBeenCalled()
  })
})

describe('(e) owner-scoping (IDOR-safe)', () => {
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })
  it('not an affiliate → 401', async () => {
    getAffMock.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })
  it('balance + operator are resolved for the SESSION operator id only', async () => {
    await post()
    expect(balMock).toHaveBeenCalledWith('affiliate', 'op1')
    expect(db.operator.findUnique.mock.calls[0][0].where).toEqual({ id: 'op1' })
  })
})

describe('(a) threshold', () => {
  it('available < 2500 → below_threshold, NO transfer/onboarding', async () => {
    balMock.mockResolvedValue({ role: 'affiliate', refId: 'op1', earnedCents: 1000, paidCents: 0, availableCents: 1000, currency: 'eur' })
    const out = await (await post()).json()
    expect(out).toMatchObject({ status: 'below_threshold', availableCents: 1000, thresholdCents: 2500 })
    expect(payPartnerMock).not.toHaveBeenCalled()
    expect(startOnboardMock).not.toHaveBeenCalled()
  })
})

describe('(b) KYC BEFORE money', () => {
  it('Connect not active → start onboarding, return link, NO transfer', async () => {
    syncMock.mockResolvedValue('pending')
    const out = await (await post()).json()
    expect(out).toMatchObject({ status: 'kyc_required', onboardingUrl: 'https://connect.stripe.test/onboard' })
    expect(startOnboardMock).toHaveBeenCalledTimes(1)
    expect(payPartnerMock).not.toHaveBeenCalled()
  })
  it('Connect active + fiscal complete → payPartner IS called', async () => {
    await post()
    expect(payPartnerMock).toHaveBeenCalledWith('affiliate', 'op1')
  })
})

describe('(g) fiscal capture at 1st withdrawal', () => {
  it('Connect active but DAC7 incomplete → fiscal_required, NO transfer', async () => {
    db.operator.findUnique.mockResolvedValue({ ...OP_COMPLETE, taxId: null })
    const out = await (await post()).json()
    expect(out).toMatchObject({ status: 'fiscal_required' })
    expect(payPartnerMock).not.toHaveBeenCalled()
  })
  it('individual without dateOfBirth → fiscal_required', async () => {
    db.operator.findUnique.mockResolvedValue({ ...OP_COMPLETE, dateOfBirth: null })
    expect((await (await post()).json()).status).toBe('fiscal_required')
    expect(payPartnerMock).not.toHaveBeenCalled()
  })
})

describe('(d) amount — server-computed, client value ignored', () => {
  it('a client-supplied amount is IGNORED; payPartner gets only (affiliate, operatorId)', async () => {
    const out = await (await post({ amountCents: 999999 })).json()
    expect(payPartnerMock).toHaveBeenCalledWith('affiliate', 'op1')
    expect(payPartnerMock.mock.calls[0]).toHaveLength(2) // role + refId — no client amount
    expect(out).toEqual({ status: 'paid', amountCents: 5000, stripeTransferId: 'tr_a1' }) // server amount
  })
})

describe('(c) idempotence / anti-double-payout', () => {
  it('payPartner already_in_progress → in_progress (no 2nd payout surfaced)', async () => {
    payPartnerMock.mockResolvedValue({ status: 'skipped', role: 'affiliate', refId: 'op1', reason: 'already_in_progress' })
    expect((await (await post()).json())).toEqual({ status: 'in_progress' })
  })
  it('payPartner failed → 502 failed (row stays recoverable, no double)', async () => {
    payPartnerMock.mockResolvedValue({ status: 'failed', role: 'affiliate', refId: 'op1', reason: 'transfer_failed' })
    const res = await post()
    expect(res.status).toBe(502)
    expect((await res.json()).status).toBe('failed')
  })
})

describe('GET status', () => {
  it('returns balance, threshold, connect status, fiscal completeness', async () => {
    const out = await (await GET()).json()
    expect(out).toMatchObject({ enabled: true, availableCents: 5000, thresholdCents: 2500, connectStatus: 'active', fiscalComplete: true })
  })
})
