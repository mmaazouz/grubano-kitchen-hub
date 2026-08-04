import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P2 — Sprint 0 characterization: refused card (4000 0000 0000 0002) ────────
// Spec: message shown, retry WITHOUT double order / double charge, the refused
// order never appears in the kitchen.
//
// These are CHARACTERIZATION tests: they photograph the CURRENT behavior of the
// code on branch sprint0-prep, bugs included. The suite must be GREEN today.
// Nothing is fixed here.
//
// What the code ACTUALLY does (read on sprint0-prep):
//   • The REAL Stripe decline happens CLIENT-side (Stripe Elements confirms the
//     PaymentIntent in the browser) → not reachable from this node harness. What
//     IS testable at route level is POST /api/orders/[id]/pay (the PI factory)
//     and the kitchen feed filter.
//   • Anti-double-paiement (audit verdict ⚪ "à confirmer") → CONFIRMED PRESENT
//     at route level, THREE layers:
//       1. order.paymentStatus === 'paid'      → 409 before any Stripe call;
//       2. existing PI status === 'succeeded'  → 409 (webhook-lag window);
//       3. deterministic idempotencyKey `orderpay-<id>-<amount>-<fee>-<prevPI>`
//          → Stripe collapses concurrent duplicate creates into ONE PI.
//   • Retry after a decline: Stripe puts the PI back to 'requires_payment_method'
//     → the route REUSES it (same client_secret, no new PI, no write). /pay never
//     calls prisma.order.create → a retry can never duplicate the ORDER either
//     (the order was created once by POST /api/orders, as 'awaiting_payment').
//   • Stripe not configured: lib/stripe.getStripe() throws 'stripe_not_configured'
//     when STRIPE_SECRET_KEY is absent → the route maps it to a 500
//     « Paiement non configuré. » (any other Stripe error → 502 retry message).
//   • Kitchen: GET /api/orders/kitchen reuses buildOrderViews, whose prisma WHERE
//     excludes status ∈ HIDDEN_ORDER_STATUSES = ['awaiting_payment','expired'];
//     the route then narrows to isKitchenStatus (received|preparing|ready).
//     NOTE: the filter is driven by Order.STATUS, never by paymentStatus — a card
//     order only becomes visible when the webhook flips it to 'received'.
//   • The webhook has NO 'payment_intent.payment_failed' handler (EVENT_TO_STATUS
//     maps only amount_capturable_updated / canceled / succeeded) → a decline
//     leaves ZERO server-side trace; the order stays 'awaiting_payment' until the
//     lazy >24h expiry. Encoded below as the FAIL-ATTENDU.

const hasStripe = !!process.env.STRIPE_SECRET_KEY // presence only — value never shown

const { db, stripe, getToken, franchise, ledger, resolveScope } = vi.hoisted(() => ({
  db: {
    order:      { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    restaurant: { findUnique: vi.fn() },
    menuItem:   { findMany: vi.fn() },
    operator:   { findMany: vi.fn() },
  },
  stripe: {
    createTicketPayment: vi.fn(),
    retrieveIntent:      vi.fn(),
    cancelIntent:        vi.fn(),
    getPublishableKey:   vi.fn(() => 'pk_test'),
    eurosToCents:        (e: number) => Math.round(e * 100), // REAL — the amount maths depends on it
  },
  getToken:     vi.fn(),
  franchise:    { computeFranchiseRoyalty: vi.fn(), recordFranchiseRoyalty: vi.fn() },
  ledger:       { recordCourierTipLedgerEntry: vi.fn() },
  resolveScope: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => stripe)
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/franchise-royalty', () => franchise)
vi.mock('@/lib/ledger', () => ledger)
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
// KEPT REAL: @/lib/commission, @/lib/promotions, @/lib/tips, @/lib/courier-accrual
// (env-driven, flags stubbed OFF below), @/lib/orders-feed, @/lib/kds.

import { POST as payOrder } from '@/app/api/orders/[id]/pay/route'
import { GET as kitchenFeed } from '@/app/api/orders/kitchen/route'
import { HIDDEN_ORDER_STATUSES } from '@/lib/orders-feed'
import { isKitchenStatus } from '@/lib/kds'

const pay = (id = 'o1') =>
  payOrder(new NextRequest(`http://x/api/orders/${id}/pay`, { method: 'POST' }), { params: { id } })
const kitchen = () => kitchenFeed(new Request('http://x/api/orders/kitchen'))

// A CARD order awaiting its payment — the P2 subject. PLATFORM (non-routed)
// restaurant so the commission/fee maths (already photographed by
// tests/orders-pay-route.test.ts) stays out of the P2 picture: fee = 0.
const ORDER = {
  id: 'o1', consumerId: 'c1', restaurantId: 'r1', status: 'awaiting_payment',
  subtotal: 22, deliveryFee: 3.5, total: 25.5, fulfillmentType: 'delivery',
  stripePaymentIntentId: null as string | null, paymentStatus: 'pending',
  paymentMethod: 'card', // P0-29: the route now reads + guards the payment mode
  pointOfSaleId: null, loyaltyCreditCents: 0, smallOrderFeeCents: 0,
}
const PLATFORM = {
  stripeAccountId: null, stripeAccountStatus: null, commissionRateDineIn: null,
  commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null,
}
// The Stripe PI as it stands right AFTER a 4000…0002 decline: Stripe returns it
// to 'requires_payment_method' (retryable), client_secret unchanged.
const refusedPi = {
  id: 'pi_old', status: 'requires_payment_method', client_secret: 'cs_old',
  amount: 2550, transfer_data: null, application_fee_amount: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Deterministic flags: money flags OFF (their ON behavior is out of P2 scope).
  vi.stubEnv('TIPS_ENABLED', '')
  vi.stubEnv('LOGISTICS_COURIER_ACCRUAL_ENABLED', '')
  vi.stubEnv('FRANCHISE_ROYALTY_ENABLED', '')
  getToken.mockResolvedValue({ sub: 'c1' })
  db.order.findUnique.mockResolvedValue(ORDER)
  db.restaurant.findUnique.mockResolvedValue(PLATFORM)
  db.order.update.mockResolvedValue({})
  stripe.getPublishableKey.mockReturnValue('pk_test')
  stripe.createTicketPayment.mockResolvedValue({ id: 'pi_new', client_secret: 'cs_new' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Route guards — every rejected path stops BEFORE any Stripe factory call ────

describe('P2 — garde-fous POST /api/orders/[id]/pay (photographie)', () => {
  it('[PASS-ACTUEL] sans token → 401, aucun appel Stripe, aucune écriture', async () => {
    getToken.mockResolvedValue(null)
    expect((await pay()).status).toBe(401)
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] commande d’un autre consommateur → 403, aucun appel Stripe', async () => {
    getToken.mockResolvedValue({ sub: 'someone-else' })
    expect((await pay()).status).toBe(403)
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] commande inconnue → 404', async () => {
    db.order.findUnique.mockResolvedValue(null)
    expect((await pay()).status).toBe(404)
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] commande annulée → 400 — plus payable', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, status: 'cancelled' })
    expect((await pay()).status).toBe(400)
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] total < 0,50 € (minimum Stripe) → 400', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, total: 0.3 })
    expect((await pay()).status).toBe(400)
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
  })
})

// ── Anti-double-paiement — audit verdict ⚪ « à confirmer » → CONFIRMED present ─

describe('P2 — anti-double-paiement (verdict audit ⚪ → CONFIRMÉ présent au niveau route)', () => {
  it('[PASS-ACTUEL] commande déjà payée (paymentStatus=paid) → 409 « Commande déjà payée. », aucun PI, aucune écriture', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, paymentStatus: 'paid' })
    const res = await pay()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Commande déjà payée.')
    expect(stripe.retrieveIntent).not.toHaveBeenCalled()
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] PI existant déjà « succeeded » (webhook en retard, paymentStatus encore pending) → 409, aucun nouveau débit', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, stripePaymentIntentId: 'pi_old' })
    stripe.retrieveIntent.mockResolvedValue({ id: 'pi_old', status: 'succeeded' })
    const res = await pay()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Commande déjà payée.')
    expect(stripe.createTicketPayment).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] retry après refus carte : le PI est RÉUTILISÉ (même client_secret) — aucun nouveau PI, aucune nouvelle commande, aucune écriture', async () => {
    // After a 4000…0002 decline Stripe reverts the PI to requires_payment_method:
    // the route's reuse branch (same routing, fee 0, same amount) returns it as-is.
    db.order.findUnique.mockResolvedValue({ ...ORDER, stripePaymentIntentId: 'pi_old' })
    stripe.retrieveIntent.mockResolvedValue(refusedPi)
    const res = await pay()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      clientSecret: 'cs_old', publishableKey: 'pk_test', amount: 2550, currency: 'eur',
    })
    expect(stripe.createTicketPayment).not.toHaveBeenCalled() // no second charge vehicle
    expect(stripe.cancelIntent).not.toHaveBeenCalled()
    expect(db.order.create).not.toHaveBeenCalled()            // /pay NEVER creates orders
    expect(db.order.update).not.toHaveBeenCalled()            // nothing rewritten on reuse
  })

  it('[PASS-ACTUEL] création fraîche : clé d’idempotence DÉTERMINISTE → un double-clic ne peut pas empiler deux débits ; paymentStatus écrit = « pending », jamais « paid »', async () => {
    const res = await pay()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      clientSecret: 'cs_new', publishableKey: 'pk_test', amount: 2550, currency: 'eur',
    })
    // orderpay-<orderId>-<amountCents>-<feeCents>-<previous PI | 'first'> — two
    // concurrent identical calls send the SAME key → Stripe collapses them.
    expect(stripe.createTicketPayment).toHaveBeenCalledTimes(1)
    const opts = stripe.createTicketPayment.mock.calls[0][0] as { idempotencyKey: string }
    expect(opts.idempotencyKey).toBe('orderpay-o1-2550-0-first')
    // The route only marks the payment as ATTEMPTED — 'paid' is webhook-only.
    expect(db.order.update).toHaveBeenCalledTimes(1)
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data:  { stripePaymentIntentId: 'pi_new', paymentStatus: 'pending' },
    })
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('[FAIL-ATTENDU: aucune trace serveur d’un refus carte — pas de paymentStatus « failed », aucun handler payment_intent.payment_failed] le retry ne relit ni n’écrit aucun statut d’échec', async () => {
    // AUDIT: after a decline the server learns NOTHING — the webhook route maps
    // only amount_capturable_updated/canceled/succeeded (payment_failed is ignored)
    // and the /pay retry below performs zero writes. The order silently stays
    // 'awaiting_payment' until the lazy >24h expiry; no failure reason, no
    // timestamp (same H1-H5 family: Order sans timestamps/motifs). After the
    // post-arbitrage fix (payment_failed handler and/or a failure trace on Order),
    // this test must be INVERTED (expect a failure-side write/trace).
    db.order.findUnique.mockResolvedValue({ ...ORDER, stripePaymentIntentId: 'pi_old' })
    stripe.retrieveIntent.mockResolvedValue(refusedPi)
    const res = await pay()
    expect(res.status).toBe(200)
    expect(db.order.update).not.toHaveBeenCalled() // no 'failed' flip, no trace — current behavior
  })
})

// ── Stripe not configured — lib/stripe 'stripe_not_configured' mapping ─────────

describe('P2 — Stripe non configuré (stripe_not_configured)', () => {
  it('[PASS-ACTUEL] lib réelle : getStripe() lève « stripe_not_configured » quand STRIPE_SECRET_KEY est absente', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '') // presence-only manipulation — no value ever read/shown
    const real = await vi.importActual<typeof import('@/lib/stripe')>('@/lib/stripe')
    expect(() => real.getStripe()).toThrowError('stripe_not_configured')
  })

  it('[PASS-ACTUEL] route : erreur stripe_not_configured → 500 « Paiement non configuré. », aucune écriture', async () => {
    stripe.createTicketPayment.mockRejectedValue(new Error('stripe_not_configured'))
    const res = await pay()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Paiement non configuré.')
    expect(db.order.update).not.toHaveBeenCalled() // the PI write never happens
  })

  it('[PASS-ACTUEL] toute autre erreur Stripe → 502 « Erreur paiement, réessayez. » (le message de retry)', async () => {
    stripe.createTicketPayment.mockRejectedValue(new Error('rate_limit'))
    const res = await pay()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Erreur paiement, réessayez.')
  })
})

// ── The refused order never reaches the kitchen (GET /api/orders/kitchen) ──────

describe('P2 — la commande refusée n’apparaît pas en cuisine', () => {
  const feedRow = (over: Record<string, unknown> = {}) => ({
    id: 'oR', status: 'received', fulfillmentType: 'delivery',
    subtotal: 22, deliveryFee: 3.5, total: 25.5, referralCode: null,
    consumerId: 'c1', items: [], createdAt: new Date('2026-07-27T09:00:00Z'),
    ...over,
  })

  beforeEach(() => {
    resolveScope.mockResolvedValue({ ok: true, restaurantId: 'r1', operatorId: 'op1' })
    db.order.findMany.mockResolvedValue([])
    db.menuItem.findMany.mockResolvedValue([])
    db.operator.findMany.mockResolvedValue([])
  })

  it('[PASS-ACTUEL] double barrière pure : awaiting_payment est masquée du feed ET n’est pas un statut cuisine', () => {
    // Barrier 1 — the resto feed hides it at the SQL level (ghost-orders filter).
    expect([...HIDDEN_ORDER_STATUSES]).toEqual(['awaiting_payment', 'expired'])
    // Barrier 2 — even if it leaked, it is not a kitchen status.
    expect(isKitchenStatus('awaiting_payment')).toBe(false)
    expect(isKitchenStatus('expired')).toBe(false)
    expect(isKitchenStatus('received')).toBe(true)
    expect(isKitchenStatus('preparing')).toBe(true)
    expect(isKitchenStatus('ready')).toBe(true)
    expect(isKitchenStatus('delivered')).toBe(false)
  })

  it('[PASS-ACTUEL] le feed exclut awaiting_payment/expired dans la REQUÊTE DB — filtre par status, PAS par paymentStatus', async () => {
    const res = await kitchen()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ orders: [] })
    expect(db.order.findMany).toHaveBeenCalledTimes(1)
    // Exact WHERE: status.notIn only — characterizes that paymentStatus plays NO
    // part in kitchen visibility (a card order appears once the webhook flips its
    // STATUS to 'received', whatever the paymentStatus column holds).
    const args = db.order.findMany.mock.calls[0][0] as { where: unknown }
    expect(args.where).toEqual({
      restaurantId: 'r1',
      status:       { notIn: ['awaiting_payment', 'expired'] },
    })
  })

  it('[PASS-ACTUEL] le board cuisine ne garde que received/preparing/ready (delivered filtrée côté route)', async () => {
    db.order.findMany.mockResolvedValue([
      feedRow(),                                       // received  → on the board
      feedRow({ id: 'oD', status: 'delivered' }),      // passes the DB filter, dropped by the kitchen slice
    ])
    const res = await kitchen()
    expect(res.status).toBe(200)
    const body = await res.json() as { orders: Array<{ id: string; status: string }> }
    expect(body.orders).toHaveLength(1)
    expect(body.orders[0]).toMatchObject({ id: 'oR', status: 'received' })
  })
})

// ── Non-testable in this node harness ─────────────────────────────────────────

describe('P2 — non testable dans ce harnais', () => {
  it.skipIf(!hasStripe)(
    '[NON-TESTABLE: refus carte réel 4000 0000 0000 0002 — nécessite le réseau Stripe + le webhook, hors harnais node] avec clé locale, getStripe() s’instancie sans lever',
    async () => {
      // The real decline round-trip (confirm in the browser → Stripe → webhook)
      // cannot run here. When a TEST key is present locally, at least characterize
      // that the configured branch of getStripe() does not throw (no network at
      // construction). Skipped in CI (no keys).
      const real = await vi.importActual<typeof import('@/lib/stripe')>('@/lib/stripe')
      expect(() => real.getStripe()).not.toThrow()
    },
  )

  it.todo('[NON-TESTABLE: UI navigateur] message d’erreur Stripe Elements affiché au client + bouton « Réessayer » du checkout /eat — hors harnais node')

  it.todo('[NON-TESTABLE: signature webhook Stripe requise] payment_intent.payment_failed est IGNORÉ par app/api/webhooks/stripe (absent d’EVENT_TO_STATUS) — la commande refusée reste « awaiting_payment » jusqu’à l’expiration lazy >24h')
})
