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

const { flagMock, disputeHandlerMock } = vi.hoisted(() => ({ flagMock: vi.fn(), disputeHandlerMock: vi.fn() }))
vi.mock('@/lib/dispute', () => ({ isChargebacksEnabled: flagMock, handleDisputeEvent: disputeHandlerMock }))

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
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

describe('webhook charge.dispute.* branch', () => {
  it('(f) flag OFF → acknowledged, NOT processed (byte-identical behaviour)', async () => {
    constructEventMock.mockReturnValue({ type: 'charge.dispute.created', data: { object: { id: 'dp_1' } } })
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, ignored: 'charge.dispute.created', gated: true })
    expect(disputeHandlerMock).not.toHaveBeenCalled()
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
