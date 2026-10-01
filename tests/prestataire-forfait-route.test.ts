import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/prestataire-forfait/[offeringId]/order (P8b) — FORFAIT paid upfront ───
// The resto orders a fixed-price offering and pays UPFRONT. DOUBLE-FLAG gated + the gates;
// the amount comes ONLY from the offering's fixedPriceCents (server). It REUSES issueServiceInvoice
// (P6) + startServiceInvoiceCheckout (P8) UNCHANGED (mocked here) → the P8 rail stays byte-identical.
// Idempotent: a re-order RESUMES the existing unpaid upfront mission. ⚠️ REAL money (TEST).

const { db, caller, conn, inv, lib } = vi.hoisted(() => ({
  db: { serviceOffering: { findUnique: vi.fn() }, serviceMission: { findFirst: vi.fn(), create: vi.fn() } },
  caller: vi.fn(),
  conn: { isPrestataireConnectLive: vi.fn() },
  inv: vi.fn(), // issueServiceInvoice
  lib: { startServiceInvoiceCheckout: vi.fn(), MIN_SERVICE_CHARGE_CENTS: 50 },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: caller }))
vi.mock('@/lib/prestataire-connect', () => conn)
vi.mock('@/lib/service-invoice', () => ({ issueServiceInvoice: inv }))
vi.mock('@/lib/service-payment', () => lib)

import { POST as ORDER } from '@/app/api/prestataire-forfait/[offeringId]/order/route'

const params = (offeringId: string) => ({ params: { offeringId } })
const req = (body?: unknown) => new Request('http://x/api/prestataire-forfait/off1/order', {
  method: 'POST', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
})
const ACTIVE_PRESTA = { status: 'active', stripeAccountId: 'acct_p', payoutStatus: 'active' }
const OFFERING = (over: Record<string, unknown> = {}) => ({
  id: 'off1', title: 'Forfait HACCP', active: true, fixedPriceCents: 15000, prestataireProfileId: 'pp1',
  prestataireProfile: ACTIVE_PRESTA, ...over,
})
const ISSUED = { id: 'inv1', number: 'PRS-2026-00001', amountCents: 15000, status: 'issued' }

beforeEach(() => {
  vi.clearAllMocks()
  conn.isPrestataireConnectLive.mockReturnValue(true)
  caller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.serviceOffering.findUnique.mockResolvedValue(OFFERING())
  db.serviceMission.findFirst.mockResolvedValue(null)      // no resumable mission by default
  db.serviceMission.create.mockResolvedValue({ id: 'm1' })
  inv.mockResolvedValue(ISSUED)
  lib.startServiceInvoiceCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/x', sessionId: 'cs_1', chargedCents: 15000 })
})

describe('forfait order — gates', () => {
  it('(1) DOUBLE FLAG OFF → 404, no work', async () => {
    conn.isPrestataireConnectLive.mockReturnValue(false)
    expect((await ORDER(req(), params('off1'))).status).toBe(404)
    expect(caller).not.toHaveBeenCalled()
    expect(db.serviceMission.create).not.toHaveBeenCalled()
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('401 no operator; 403 non-restaurant role', async () => {
    caller.mockResolvedValue(null)
    expect((await ORDER(req(), params('off1'))).status).toBe(401)
    caller.mockResolvedValue({ id: 'op1', role: 'supplier' })
    expect((await ORDER(req(), params('off1'))).status).toBe(403)
  })
  it('404 offering not found; 409 inactive offering', async () => {
    db.serviceOffering.findUnique.mockResolvedValue(null)
    expect((await ORDER(req(), params('off1'))).status).toBe(404)
    db.serviceOffering.findUnique.mockResolvedValue(OFFERING({ active: false }))
    expect((await ORDER(req(), params('off1'))).status).toBe(409)
  })
  it('(2) 409 when the offering is NOT a forfait (no fixed price)', async () => {
    db.serviceOffering.findUnique.mockResolvedValue(OFFERING({ fixedPriceCents: null }))
    expect((await ORDER(req(), params('off1'))).status).toBe(409)
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('(5) 400 when the fixed price is below the minimum', async () => {
    db.serviceOffering.findUnique.mockResolvedValue(OFFERING({ fixedPriceCents: 10 }))
    expect((await ORDER(req(), params('off1'))).status).toBe(400)
  })
  it('(3a) 403 when the prestataire business status is not active', async () => {
    db.serviceOffering.findUnique.mockResolvedValue(OFFERING({ prestataireProfile: { status: 'suspended', stripeAccountId: 'acct_p', payoutStatus: 'active' } }))
    expect((await ORDER(req(), params('off1'))).status).toBe(403)
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('(3b) 403 when the prestataire is not payout-active', async () => {
    db.serviceOffering.findUnique.mockResolvedValue(OFFERING({ prestataireProfile: { status: 'active', stripeAccountId: null, payoutStatus: 'pending' } }))
    expect((await ORDER(req(), params('off1'))).status).toBe(403)
    db.serviceOffering.findUnique.mockResolvedValue(OFFERING({ prestataireProfile: { status: 'active', stripeAccountId: 'acct_p', payoutStatus: 'pending' } }))
    expect((await ORDER(req(), params('off1'))).status).toBe(403)
  })
})

describe('forfait order — nominal + server amount + ids from session/offering', () => {
  it('creates an accepted/upfront mission, issues the invoice, charges via the P8 checkout', async () => {
    const res = await ORDER(req(), params('off1'))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toContain('checkout')

    // mission created at 'accepted' + 'upfront', amount = the fixed price, ids from session/offering.
    expect(db.serviceMission.create.mock.calls[0][0].data).toMatchObject({
      restaurantOperatorId: 'op1', prestataireProfileId: 'pp1', serviceOfferingId: 'off1',
      quoteAmountCents: 15000, status: 'accepted', paymentTiming: 'upfront',
    })
    // invoice issued for the fixed price, with the session/offering ids.
    expect(inv.mock.calls[0][0]).toEqual({ serviceMissionId: 'm1', restaurantOperatorId: 'op1', prestataireProfileId: 'pp1', amountCents: 15000 })
    // the REUSED P8 checkout is called with the issued invoice + the prestataire account.
    expect(lib.startServiceInvoiceCheckout.mock.calls[0][0]).toMatchObject({
      invoice: { id: 'inv1', number: 'PRS-2026-00001', amountCents: 15000 }, prestataireAccountId: 'acct_p',
    })
  })

  it('a client-supplied amount in the body is IGNORED — the charge uses the offering fixed price', async () => {
    await ORDER(req({ amountCents: 1, fixedPriceCents: 999999, totalCents: 999999 }), params('off1'))
    expect(db.serviceMission.create.mock.calls[0][0].data.quoteAmountCents).toBe(15000)
    expect(lib.startServiceInvoiceCheckout.mock.calls[0][0].invoice.amountCents).toBe(15000)
  })
})

describe('forfait order — idempotent resume (no duplicate mission / no double charge)', () => {
  it('reuses an existing unpaid upfront mission (no new create), one checkout', async () => {
    db.serviceMission.findFirst.mockResolvedValue({ id: 'm_existing' })
    const res = await ORDER(req(), params('off1'))
    expect(res.status).toBe(200)
    expect(db.serviceMission.create).not.toHaveBeenCalled()                  // resumed, not duplicated
    expect(inv.mock.calls[0][0].serviceMissionId).toBe('m_existing')          // same mission
    expect(lib.startServiceInvoiceCheckout).toHaveBeenCalledTimes(1)
    // the resume is scoped to the caller + offering + UPFRONT + UNPAID, and covers BOTH 'accepted'
    // AND 'done' (a forfait marked done before payment must not be re-billed via a new mission).
    const where = db.serviceMission.findFirst.mock.calls[0][0].where
    expect(where).toMatchObject({ restaurantOperatorId: 'op1', serviceOfferingId: 'off1', paymentTiming: 'upfront' })
    expect(where.status).toEqual({ in: ['accepted', 'done'] })
    expect(where.OR).toEqual([{ invoice: { is: null } }, { invoice: { status: { not: 'paid' } } }])
  })
  it('409 when the (resumed) invoice is already paid — no second charge', async () => {
    inv.mockResolvedValue({ ...ISSUED, status: 'paid' })
    expect((await ORDER(req(), params('off1'))).status).toBe(409)
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
})
