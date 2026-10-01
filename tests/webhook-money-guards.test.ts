import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── LOT B money-flow — gardes webhook + anti-double-hold ─────────────────────
// 1. CROSS-TALK (M1-01/M6-03) : un PI d'ADDITION/COMMANDE (metadata ticketId/
//    orderId) ne pilote JAMAIS le cycle empreinte — son payment_intent.canceled
//    basculait depositStatus en 'released' pendant que le vrai hold restait
//    requires_capture (état menteur + libérations légitimes sautées ensuite).
// 2. STALE-PI empreinte : un PI d'empreinte orphelin n'écrase pas l'état du
//    hold courant.
// 3. STALE-PI encaissé (M2-03/M6-01) : argent réel capturé sur un PI périmé →
//    alerte admin idempotente (plus seulement un console.error).
// 4. HEAL-ON-REPLAY (M2-04) : une commande 'paid' restée awaiting_payment
//    (crash entre paid et reveal) est révélée au retry Stripe.

const { db, stripe, refund, alerts } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tableTicket:        { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn() },
    loyaltyCustomer:    { findUnique: vi.fn() },
    reservation:        { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    ledgerEntry:        { create: vi.fn() },
    $transaction:       vi.fn(),
  },
  stripe: { getStripe: vi.fn(), retrieveChargeFacts: vi.fn(), mapAccountStatus: vi.fn(), constructEvent: vi.fn() },
  refund: { isRefundsEnabled: vi.fn(() => false), isGhostOrderAutoRefundEnabled: vi.fn(() => false), executeRefund: vi.fn() },
  alerts: { sendAdminGhostOrderAlert: vi.fn(async () => ({ status: 'sent' })), sendAdminStalePiAlert: vi.fn(async () => ({ status: 'sent' })) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, retrieveChargeFacts: stripe.retrieveChargeFacts, mapAccountStatus: stripe.mapAccountStatus }))
vi.mock('@/lib/refund', () => ({ isRefundsEnabled: refund.isRefundsEnabled, isGhostOrderAutoRefundEnabled: refund.isGhostOrderAutoRefundEnabled, executeRefund: refund.executeRefund }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminGhostOrderAlert: alerts.sendAdminGhostOrderAlert, sendAdminStalePiAlert: alerts.sendAdminStalePiAlert }))

import { POST } from '@/app/api/webhooks/stripe/route'

const fire = (type: string, pi: Record<string, unknown>) => {
  stripe.constructEvent.mockReturnValue({ type, data: { object: pi } })
  return POST(new Request('http://x/api/webhooks/stripe', { method: 'POST', body: 'raw', headers: { 'stripe-signature': 'sig' } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: stripe.constructEvent } })
  stripe.retrieveChargeFacts.mockResolvedValue({ chargeId: 'ch_1', stripeFeeCents: 250, transferId: 'tr_1' })
  db.ledgerEntry.create.mockResolvedValue({ id: 'le1' })
  db.order.update.mockResolvedValue({})
  db.order.updateMany.mockResolvedValue({ count: 0 })
  db.reservation.findUnique.mockResolvedValue(null)
  db.reservation.findFirst.mockResolvedValue(null)
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

describe('CROSS-TALK — la branche empreinte ignore les PIs addition/commande', () => {
  it("payment_intent.canceled d'un PI d'ADDITION (ticketId + reservationId) → ignored, depositStatus JAMAIS touché", async () => {
    const res = await fire('payment_intent.canceled', {
      id: 'pi_bill_old', metadata: { ticketId: 't1', reservationId: 'resa1', restaurantId: 'r1' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ignored: 'bill_or_order_pi' })
    expect(db.reservation.findUnique).not.toHaveBeenCalled()
    expect(db.reservation.update).not.toHaveBeenCalled()
  })

  it("payment_intent.canceled d'un PI de COMMANDE (orderId) → même exclusion", async () => {
    const res = await fire('payment_intent.canceled', {
      id: 'pi_order_old', metadata: { orderId: 'o1', reservationId: 'resa1', restaurantId: 'r1' },
    })
    expect(await res.json()).toMatchObject({ ignored: 'bill_or_order_pi' })
    expect(db.reservation.update).not.toHaveBeenCalled()
  })

  it("un VRAI PI d'empreinte (reservationId seul) pilote toujours le cycle — canceled → released", async () => {
    db.reservation.findUnique.mockResolvedValue({ id: 'resa1', depositStatus: 'authorized', stripePaymentIntentId: 'pi_hold' })
    db.reservation.update.mockResolvedValue({})
    const res = await fire('payment_intent.canceled', {
      id: 'pi_hold', metadata: { reservationId: 'resa1', restaurantId: 'r1' },
    })
    expect(await res.json()).toMatchObject({ status: 'released' })
    expect(db.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositStatus: 'released' }),
    }))
  })

  it("STALE-PI empreinte : un PI d'empreinte orphelin (≠ PI courant) est skippé", async () => {
    db.reservation.findUnique.mockResolvedValue({ id: 'resa1', depositStatus: 'authorized', stripePaymentIntentId: 'pi_hold_CURRENT' })
    const res = await fire('payment_intent.canceled', {
      id: 'pi_hold_ORPHAN', metadata: { reservationId: 'resa1', restaurantId: 'r1' },
    })
    expect(await res.json()).toMatchObject({ skipped: 'stale_deposit_pi' })
    expect(db.reservation.update).not.toHaveBeenCalled()
  })
})

describe('STALE-PI encaissé — alerte admin (M2-03/M6-01)', () => {
  it('succeeded sur un PI périmé de COMMANDE → non confirmé + sendAdminStalePiAlert', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', status: 'received', total: 105, paymentStatus: 'pending', stripePaymentIntentId: 'pi_CURRENT' })
    const res = await fire('payment_intent.succeeded', {
      id: 'pi_ORPHAN', amount_received: 10500, amount: 10500, application_fee_amount: 0,
      currency: 'eur', latest_charge: 'ch_1', metadata: { restaurantId: 'r1', orderId: 'o1', grubano_channel: 'pickup' },
    })
    expect(await res.json()).toMatchObject({ reason: 'stale_pi' })
    expect(alerts.sendAdminStalePiAlert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'order', entityId: 'o1', paymentIntentId: 'pi_ORPHAN', currentPiId: 'pi_CURRENT', amountCents: 10500,
    }))
    expect(db.order.update).not.toHaveBeenCalled() // jamais confirmé par un PI périmé
  })
})

describe('HEAL-ON-REPLAY — reveal rejoué sur une commande paid restée cachée (M2-04)', () => {
  it("replay succeeded sur une commande déjà 'paid' → updateMany de reveal rejoué (idempotent)", async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', status: 'awaiting_payment', total: 105, paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' })
    db.order.updateMany.mockResolvedValue({ count: 1 }) // la commande était bien coincée
    const res = await fire('payment_intent.succeeded', {
      id: 'pi_1', amount_received: 10500, amount: 10500, application_fee_amount: 0,
      currency: 'eur', latest_charge: 'ch_1', metadata: { restaurantId: 'r1', orderId: 'o1', grubano_channel: 'pickup' },
    })
    expect(await res.json()).toMatchObject({ noop: true, healed: true })
    expect(db.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', status: 'awaiting_payment' },
      data:  { status: 'received' },
    })
  })

  it('replay sur une commande paid DÉJÀ révélée → noop pur (0 ligne touchée, pas de healed)', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', status: 'received', total: 105, paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' })
    db.order.updateMany.mockResolvedValue({ count: 0 })
    const res = await fire('payment_intent.succeeded', {
      id: 'pi_1', amount_received: 10500, amount: 10500, application_fee_amount: 0,
      currency: 'eur', latest_charge: 'ch_1', metadata: { restaurantId: 'r1', orderId: 'o1', grubano_channel: 'pickup' },
    })
    const j = await res.json()
    expect(j.noop).toBe(true)
    expect(j.healed).toBeUndefined()
  })
})
