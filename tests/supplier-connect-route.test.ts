import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── /api/supplier/connect + /api/webhooks/stripe-supplier (B2B Slice 5b) ──────
// POST onboarding is gated + session-scoped; the B2B webhook is SEPARATE and only
// handles account.updated for supplier accounts.

const { db, caller, lib, stripe } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn() } },
  caller: vi.fn(),
  lib: { isSupplierConnectEnabled: vi.fn(), isSupplierConnectLive: vi.fn(), startSupplierOnboarding: vi.fn(), syncSupplierPayoutStatus: vi.fn(), applySupplierAccountStatus: vi.fn() },
  stripe: { getStripe: vi.fn(), mapAccountStatus: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-account', () => ({ callerSupplierProfile: caller, isSupplierEnabled: () => process.env.SUPPLIER_ENABLED === 'true' }))
vi.mock('@/lib/supplier-connect', () => lib)
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, mapAccountStatus: stripe.mapAccountStatus }))

import { POST as CONNECT_POST } from '@/app/api/supplier/connect/route'
import { POST as WEBHOOK_POST } from '@/app/api/webhooks/stripe-supplier/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.SUPPLIER_ENABLED = 'true' })
afterEach(() => { delete process.env.SUPPLIER_ENABLED })

const connectPost = () => new Request('http://x/api/supplier/connect', { method: 'POST' })
const webhookPost = (body = '{}') =>
  new Request('http://x/api/webhooks/stripe-supplier', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body })

beforeEach(() => vi.clearAllMocks())

describe('POST /api/supplier/connect — immatriculation gate + session scoping', () => {
  it('403 gated when the gate is CLOSED (no onboarding started)', async () => {
    lib.isSupplierConnectEnabled.mockReturnValue(false)
    const res = await CONNECT_POST(connectPost())
    expect(res.status).toBe(403)
    expect((await res.json()).gated).toBe(true)
    expect(lib.startSupplierOnboarding).not.toHaveBeenCalled()
  })

  it('401 when not a supplier; 403 when the supplier is not active', async () => {
    lib.isSupplierConnectEnabled.mockReturnValue(true)
    caller.mockResolvedValue(null)
    expect((await CONNECT_POST(connectPost())).status).toBe(401)
    caller.mockResolvedValue({ id: 'p1', status: 'pending' })
    expect((await CONNECT_POST(connectPost())).status).toBe(403)
  })

  it('active supplier → onboarding for ITS OWN profile (session, not body), returns the url', async () => {
    lib.isSupplierConnectEnabled.mockReturnValue(true)
    caller.mockResolvedValue({ id: 'p1', status: 'active' })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'p1', stripeAccountId: null })
    lib.startSupplierOnboarding.mockResolvedValue({ url: 'https://connect.stripe.test/x', accountId: 'acct_1' })
    const res = await CONNECT_POST(connectPost())
    expect(res.status).toBe(200)
    expect((await res.json()).url).toContain('stripe')
    expect(lib.startSupplierOnboarding.mock.calls[0][0]).toEqual({ id: 'p1', stripeAccountId: null })
  })
})

describe('POST /api/webhooks/stripe-supplier — SEPARATE B2B webhook', () => {
  // P0-06 — le webhook est désormais DOUBLE-gaté (rôle + connect, patron prestataire).
  // Ces tests exercent le comportement gate OUVERT ; le 404 gate-fermé est prouvé
  // ci-dessous et dans tests/role-locks.test.ts.
  beforeEach(() => { lib.isSupplierConnectLive.mockReturnValue(true) })

  it('404 when the role/connect gate is CLOSED — before the secret is read', async () => {
    lib.isSupplierConnectLive.mockReturnValue(false)
    delete process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET
    expect((await WEBHOOK_POST(webhookPost())).status).toBe(404)
  })

  it('400 when the dedicated secret is not configured', async () => {
    delete process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET
    expect((await WEBHOOK_POST(webhookPost())).status).toBe(400)
  })

  it('account.updated → applies the mapped status to the supplier', async () => {
    process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET = 'whsec_test'
    stripe.mapAccountStatus.mockReturnValue('active')
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'account.updated', data: { object: { id: 'acct_1' } } }) } })
    const res = await WEBHOOK_POST(webhookPost())
    expect(res.status).toBe(200)
    expect(lib.applySupplierAccountStatus).toHaveBeenCalledWith('acct_1', 'active')
  })

  it('ignores non-account.updated events', async () => {
    process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET = 'whsec_test'
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'payment_intent.succeeded', data: { object: {} } }) } })
    await WEBHOOK_POST(webhookPost())
    expect(lib.applySupplierAccountStatus).not.toHaveBeenCalled()
  })

  it('400 on a bad signature', async () => {
    process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET = 'whsec_test'
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => { throw new Error('bad sig') } } })
    expect((await WEBHOOK_POST(webhookPost())).status).toBe(400)
  })
})
