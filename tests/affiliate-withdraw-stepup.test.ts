import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Withdraw step-up wiring (Phase 3 — Agent 88) ─────────────────────────────────
// The step-up guard sits at the TOP of POST /api/affiliate/withdraw, BEFORE any money
// logic. requireStepUp is mocked (its own logic is in step-up.test): refused → 401 +
// NO balance/payPartner (money untouched); ok → the withdrawal proceeds EXACTLY as
// before → payPartner('affiliate', id). GET signals stepUp only when the flag is ON.

const { db, session, aff, payout, connect, bal, threshold, step, otp } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn() }, payout: { findMany: vi.fn() } },
  session: vi.fn(),
  aff: { isAffiliateEnabled: vi.fn(), getAffiliateByOperator: vi.fn() },
  payout: { isAffiliateConnectEnabled: vi.fn(), payPartner: vi.fn() },
  connect: { startConnectOnboarding: vi.fn(), syncConnectStatus: vi.fn() },
  bal: vi.fn(),
  threshold: vi.fn(),
  step: { requireStepUp: vi.fn() },
  otp: { isMoneyStepUpEnabled: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/affiliate-account', () => aff)
vi.mock('@/lib/creator-payout', () => payout)
vi.mock('@/lib/connect-onboarding', () => connect)
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: bal }))
vi.mock('@/lib/payout-threshold', () => ({ payoutMinCents: threshold }))
vi.mock('@/lib/step-up', () => step)
vi.mock('@/lib/email-otp', () => otp)

import { GET, POST } from '@/app/api/affiliate/withdraw/route'

const post = (body?: unknown) => POST(new Request('http://x/api/affiliate/withdraw', {
  method: 'POST', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
}))

beforeEach(() => {
  vi.clearAllMocks()
  aff.isAffiliateEnabled.mockReturnValue(true)
  payout.isAffiliateConnectEnabled.mockReturnValue(true)
  session.mockResolvedValue({ user: { id: 'op1', email: 'u@x.fr' } })
  aff.getAffiliateByOperator.mockResolvedValue({ id: 'a1', operatorId: 'op1' })
  db.operator.findUnique.mockResolvedValue({
    id: 'op1', email: 'u@x.fr', affiliateStripeAccountId: 'acct_a', affiliatePayoutStatus: 'active',
    registeredAddress: '1 rue', taxId: 'TIN', taxIdCountry: 'FR', dateOfBirth: null, sellerType: 'entity',
  })
  connect.syncConnectStatus.mockResolvedValue('active')
  bal.mockResolvedValue({ availableCents: 5000, currency: 'eur' })
  threshold.mockReturnValue(2500)
  payout.payPartner.mockResolvedValue({ status: 'paid', amountCents: 5000, stripeTransferId: 'tr_1' })
  db.payout.findMany.mockResolvedValue([]) // recentPayouts (GET history)
  otp.isMoneyStepUpEnabled.mockReturnValue(false)
})

describe('POST — step-up guard before any money', () => {
  it('step-up REFUSED → 401 stepup_required, NO balance read, NO payPartner', async () => {
    step.requireStepUp.mockResolvedValue({ ok: false, status: 401, reason: 'stepup_required' })
    const res = await post()
    expect(res.status).toBe(401)
    expect((await res.json()).status).toBe('stepup_required')
    expect(step.requireStepUp).toHaveBeenCalledWith('u@x.fr', 'stepup:withdraw', null)
    expect(bal).not.toHaveBeenCalled()
    expect(payout.payPartner).not.toHaveBeenCalled()
  })

  it('step-up INVALID code (from body) → 401 stepup_invalid, NO payPartner', async () => {
    step.requireStepUp.mockResolvedValue({ ok: false, status: 401, reason: 'stepup_invalid' })
    const res = await post({ stepUpCode: '000000' })
    expect(res.status).toBe(401)
    expect((await res.json()).status).toBe('stepup_invalid')
    expect(step.requireStepUp).toHaveBeenCalledWith('u@x.fr', 'stepup:withdraw', '000000')
    expect(payout.payPartner).not.toHaveBeenCalled()
  })

  it('step-up OK → withdrawal proceeds UNCHANGED → payPartner(affiliate, op1) paid', async () => {
    step.requireStepUp.mockResolvedValue({ ok: true })
    const res = await post({ stepUpCode: '424242' })
    expect(res.status).toBe(200)
    expect((await res.json())).toMatchObject({ status: 'paid', amountCents: 5000 })
    expect(payout.payPartner).toHaveBeenCalledWith('affiliate', 'op1')
  })

  it('OFF path (guard ok, no code) → byte-identical: body-less POST still pays', async () => {
    step.requireStepUp.mockResolvedValue({ ok: true }) // OFF → requireStepUp returns ok
    const res = await post()
    expect(res.status).toBe(200)
    expect(payout.payPartner).toHaveBeenCalledWith('affiliate', 'op1')
    expect(step.requireStepUp).toHaveBeenCalledWith('u@x.fr', 'stepup:withdraw', null)
  })
})

describe('GET — stepUp signal only when ON', () => {
  it('flag ON → response carries stepUp:true', async () => {
    otp.isMoneyStepUpEnabled.mockReturnValue(true)
    const body = await (await GET()).json()
    expect(body.stepUp).toBe(true)
  })
  it('flag OFF → no stepUp key (byte-identical)', async () => {
    otp.isMoneyStepUpEnabled.mockReturnValue(false)
    const body = await (await GET()).json()
    expect('stepUp' in body).toBe(false)
  })
})
