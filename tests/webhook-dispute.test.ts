import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.5-B — webhook carve-out: charge.dispute.* branch, gated, additive ──────────
// Proves: (f) flag OFF → the dispute event is ACKNOWLEDGED without processing
// (byte-identical behaviour); flag ON → routed to lib/dispute; and the new branch
// does NOT affect existing events (a non-dispute event never reaches the dispute
// handler and flows exactly as before).

const { stripeMock, constructEventMock } = vi.hoisted(() => {
  const constructEventMock = vi.fn()
  return {
    constructEventMock,
    stripeMock: {
      webhooks: { constructEvent: constructEventMock },
    },
  }
})
vi.mock('@/lib/stripe', () => ({
  getStripe: () => stripeMock,
  mapAccountStatus: vi.fn(() => 'active'),
  retrieveChargeFacts: vi.fn(async () => ({ chargeId: null, stripeFeeCents: null, transferId: null })),
}))

const { flagMock, disputeHandlerMock, recorderMock } = vi.hoisted(() => ({ flagMock: vi.fn(), disputeHandlerMock: vi.fn(), recorderMock: vi.fn() }))
// T-107: with the rail CLOSED the branch now calls the RECORDER, not nothing at all.
vi.mock('@/lib/dispute', () => ({ isChargebacksEnabled: flagMock, handleDisputeEvent: disputeHandlerMock, recordDisputeObservation: recorderMock }))

const { db } = vi.hoisted(() => ({
  db: { restaurant: { findUnique: vi.fn() }, reservation: { findUnique: vi.fn(), findFirst: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/deposit', () => ({ releaseHold: vi.fn() }))
vi.mock('@/lib/ledger', () => ({ recordLedgerEntry: vi.fn(async () => ({ ok: true })) }))

import { POST } from '@/app/api/webhooks/stripe/route'

const post = () => POST(new Request('https://app.grubano.com/api/webhooks/stripe', {
  method: 'POST', headers: { 'stripe-signature': 'sig_test' }, body: 'rawbody',
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  flagMock.mockReturnValue(false)
  disputeHandlerMock.mockResolvedValue({ handled: 'charge.dispute.closed', outcome: 'lost', reversed: true })
  recorderMock.mockResolvedValue({ handled: 'charge.dispute.created', outcome: 'recorded', recordedOnly: true, reversed: false })
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

describe('webhook charge.dispute.* branch', () => {
  it('T-107 — flag OFF → RECORDED, never unwound (the founder inverted this assertion)', async () => {
    /* This test used to assert « acknowledged, NOT processed (byte-identical behaviour) », and that WAS the
       contract: the flag protected the unwind, and the branch did nothing at all. The founder then ruled
       (2026-09-28) that it must also do the one thing the flag was never meant to prevent — RECORD an external
       reality that has already happened: « les flags doivent empêcher d'INITIER une opération financière, pas
       empêcher d'enregistrer une réalité externe qui a déjà eu lieu. » Stripe had already pulled the funds, the
       restaurant was still invoiced, and nothing in our books knew.
       The important half of the old assertion is KEPT and is the first one below: the UNWIND is still not run. */
    constructEventMock.mockReturnValue({ type: 'charge.dispute.created', data: { object: { id: 'dp_1' } } })
    const res = await post()
    expect(disputeHandlerMock, 'the unwind must NEVER run with the rail closed').not.toHaveBeenCalled()
    expect(recorderMock, 'but the fact is recorded').toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, outcome: 'recorded', recordedOnly: true, gated: true })
  })

  it('T-107 — a record that FAILS answers 503, so Stripe redelivers rather than losing the fact', async () => {
    constructEventMock.mockReturnValue({ type: 'charge.dispute.closed', data: { object: { id: 'dp_2', status: 'lost' } } })
    recorderMock.mockResolvedValue({ handled: 'charge.dispute.closed', outcome: 'recorded', recordedOnly: true, retryable: true, reason: 'record_failed' })
    const res = await post()
    expect(res.status).toBe(503)
    expect(disputeHandlerMock).not.toHaveBeenCalled()
  })

  it('T-106 — a retryable UNWIND answers 503, never a misleading 200', async () => {
    flagMock.mockReturnValue(true)
    constructEventMock.mockReturnValue({ type: 'charge.dispute.closed', data: { object: { id: 'dp_3', status: 'lost' } } })
    disputeHandlerMock.mockResolvedValue({ handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, retryable: true, reason: 'clawback_failed', reverseTransferCents: 4600 })
    const res = await post()
    expect(res.status, 'money moved and our state is not finalized — Stripe must come back').toBe(503)
    expect(await res.json()).toMatchObject({ received: false, reason: 'clawback_failed', reverseTransferCents: 4600 })
  })

  it('flag ON → routed to lib/dispute.handleDisputeEvent', async () => {
    flagMock.mockReturnValue(true)
    const event = { type: 'charge.dispute.closed', data: { object: { id: 'dp_1', status: 'lost' } } }
    constructEventMock.mockReturnValue(event)
    const res = await post()
    expect(res.status).toBe(200)
    expect(disputeHandlerMock).toHaveBeenCalledTimes(1)
    expect(disputeHandlerMock).toHaveBeenCalledWith(event)
    expect(await res.json()).toMatchObject({ received: true, handled: 'charge.dispute.closed', outcome: 'lost' })
  })

  it('flag ON but a NON-dispute event → dispute handler NOT called, existing flow runs', async () => {
    flagMock.mockReturnValue(true)
    db.restaurant.findUnique.mockResolvedValue(null) // account.updated → no matching restaurant
    constructEventMock.mockReturnValue({ type: 'account.updated', data: { object: { id: 'acct_x' } } })
    const res = await post()
    expect(res.status).toBe(200)
    expect(disputeHandlerMock).not.toHaveBeenCalled()           // carve-out doesn't touch existing events
    expect(await res.json()).toMatchObject({ received: true, matched: false })
  })

  it('invalid signature → 400 (dispute branch never reached)', async () => {
    constructEventMock.mockImplementation(() => { throw new Error('bad sig') })
    const res = await post()
    expect(res.status).toBe(400)
    expect(disputeHandlerMock).not.toHaveBeenCalled()
  })
})
