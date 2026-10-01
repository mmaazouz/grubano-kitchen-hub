import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/prestataire/connect + /api/webhooks/stripe-prestataire (services P7) ──
// POST onboarding is DOUBLE-FLAG gated (404 when off) + session-scoped; the services
// webhook is SEPARATE and only handles account.updated (NO payment branch — that is P8).

const { db, caller, lib, stripe } = vi.hoisted(() => ({
  db: { prestataireProfile: { findUnique: vi.fn() } },
  caller: vi.fn(),
  lib: { isPrestataireConnectLive: vi.fn(), startPrestataireOnboarding: vi.fn(), syncPrestatairePayoutStatus: vi.fn(), applyPrestataireAccountStatus: vi.fn() },
  stripe: { getStripe: vi.fn(), mapAccountStatus: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-account', () => ({ callerPrestataireProfile: caller }))
vi.mock('@/lib/prestataire-connect', () => lib)
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, mapAccountStatus: stripe.mapAccountStatus }))

import { POST as CONNECT_POST, GET as CONNECT_GET } from '@/app/api/prestataire/connect/route'
import { POST as WEBHOOK_POST } from '@/app/api/webhooks/stripe-prestataire/route'

const connectPost = () => new Request('http://x/api/prestataire/connect', { method: 'POST' })
const webhookPost = (body = '{}') =>
  new Request('http://x/api/webhooks/stripe-prestataire', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body })

beforeEach(() => {
  vi.clearAllMocks()
  lib.isPrestataireConnectLive.mockReturnValue(true) // double flag ON by default
})

describe('DOUBLE FLAG OFF → 404 everywhere, no work', () => {
  it('POST + GET + webhook all 404; no onboarding/sync/apply/Stripe', async () => {
    lib.isPrestataireConnectLive.mockReturnValue(false)
    expect((await CONNECT_POST(connectPost())).status).toBe(404)
    expect((await CONNECT_GET()).status).toBe(404)
    expect((await WEBHOOK_POST(webhookPost())).status).toBe(404)
    expect(caller).not.toHaveBeenCalled()
    expect(lib.startPrestataireOnboarding).not.toHaveBeenCalled()
    expect(lib.applyPrestataireAccountStatus).not.toHaveBeenCalled()
    expect(stripe.getStripe).not.toHaveBeenCalled()
  })
})

describe('POST /api/prestataire/connect — session scoping (no IDOR)', () => {
  it('401 when not a prestataire; 403 when the prestataire is not active', async () => {
    caller.mockResolvedValue(null)
    expect((await CONNECT_POST(connectPost())).status).toBe(401)
    caller.mockResolvedValue({ id: 'p1', status: 'pending' })
    expect((await CONNECT_POST(connectPost())).status).toBe(403)
    expect(lib.startPrestataireOnboarding).not.toHaveBeenCalled()
  })

  it('active prestataire → onboarding for ITS OWN profile (session, never a body id), returns the url', async () => {
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'p1', stripeAccountId: null })
    lib.startPrestataireOnboarding.mockResolvedValue({ url: 'https://connect.stripe.test/x', accountId: 'acct_1' })
    const res = await CONNECT_POST(connectPost())
    expect(res.status).toBe(200)
    expect((await res.json()).url).toContain('stripe')
    // the profile passed to onboarding is the SESSION's, resolved by id — not a request body.
    expect(db.prestataireProfile.findUnique.mock.calls[0][0].where).toEqual({ id: 'p1' })
    expect(lib.startPrestataireOnboarding.mock.calls[0][0]).toEqual({ id: 'p1', stripeAccountId: null })
  })
})

describe('GET /api/prestataire/connect — own status', () => {
  it('401 without a profile; otherwise reflects the live status', async () => {
    caller.mockResolvedValue(null)
    expect((await CONNECT_GET()).status).toBe(401)
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'p1', stripeAccountId: 'acct_1', payoutStatus: 'pending' })
    lib.syncPrestatairePayoutStatus.mockResolvedValue('active')
    const d = await (await CONNECT_GET()).json()
    expect(d).toEqual({ status: 'active', hasAccount: true })
  })
})

describe('POST /api/webhooks/stripe-prestataire — SEPARATE services webhook (account.updated only)', () => {
  it('400 when the dedicated secret is not configured', async () => {
    delete process.env.STRIPE_PRESTATAIRE_WEBHOOK_SECRET
    expect((await WEBHOOK_POST(webhookPost())).status).toBe(400)
  })

  it('account.updated → applies the mapped status to the prestataire (by account id)', async () => {
    process.env.STRIPE_PRESTATAIRE_WEBHOOK_SECRET = 'whsec_test'
    stripe.mapAccountStatus.mockReturnValue('active')
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'account.updated', data: { object: { id: 'acct_1' } } }) } })
    const res = await WEBHOOK_POST(webhookPost())
    expect(res.status).toBe(200)
    expect(lib.applyPrestataireAccountStatus).toHaveBeenCalledWith('acct_1', 'active')
  })

  it('ignores payment events — NO money branch in P7 (checkout/payment_intent → no apply)', async () => {
    process.env.STRIPE_PRESTATAIRE_WEBHOOK_SECRET = 'whsec_test'
    for (const type of ['checkout.session.completed', 'payment_intent.succeeded']) {
      stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type, data: { object: {} } }) } })
      await WEBHOOK_POST(webhookPost())
    }
    expect(lib.applyPrestataireAccountStatus).not.toHaveBeenCalled()
  })

  it('400 on a bad signature', async () => {
    process.env.STRIPE_PRESTATAIRE_WEBHOOK_SECRET = 'whsec_test'
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => { throw new Error('bad sig') } } })
    expect((await WEBHOOK_POST(webhookPost())).status).toBe(400)
  })
})
