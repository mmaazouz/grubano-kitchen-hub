import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P8 — CASH order, then pay it by CARD — ÉTAT VAGUE 1 (P0-02) ──────────────
// Two acts. ACT 1 was re-photographed after P0-02 (Q2 : espèces hors pilote,
// tenu CÔTÉ SERVEUR — Q8) ; ACT 2 still photographs the LEGACY exposure as-is:
//   ACT 1 — POST /api/orders with paymentMethod:'cash' (or the legacy 'wallet')
//     → REFUSED 400 with an explicit French message + code
//     'payment_method_unavailable', BEFORE any DB/economic side effect. The old
//     Sprint-0 photographs (order created 'received', paymentStatus null forever,
//     points provisioned on a never-collected order) are INVERTED accordingly.
//   ACT 2 — POST /api/orders/[id]/pay on an EXISTING cash order row (legacy rows
//     created before P0-02 survive in DB; the direct URL /eat/checkout/[orderId]
//     still reaches them) → the route STILL creates a PaymentIntent WITHOUT
//     OBJECTION: its prisma select does not even READ paymentMethod, so no guard
//     on it is structurally possible. The row then carries paymentStatus:'pending'
//     + a card PI while paymentMethod stays 'cash' → double-collection risk
//     remains OPEN on legacy rows (signalé, hors périmètre P0-02 — the founder's
//     read-only SQL inventory quantifies the exposed rows).
//
// Mock pattern copied from tests/p1-p10/p3-annulation-resto-payee.test.ts and
// tests/order-refund.test.ts (same domain). No real DB, no real Stripe.

const hasStripe = !!process.env.STRIPE_SECRET_KEY // presence only — value never shown

const {
  db, getToken, rateLimit,
  loadHoursContext, isOpenAtCtx, nextOpeningCtx, nextOpeningLabelFr,
  computeApplicationFee, resolveCommissionRate,
  fetchActivePromotions, pickBestPromotion, resolveCodePromo, commissionBaseCents, commissionBaseMode,
  resolveLoyaltyCredit, estimateStripeFeeCents, committedRoyaltyCents,
  smallOrderFeeCents, netBeforeAffiliateCents,
  isTipsEnabled, sanitizeTipCents,
  isFranchisePosTaggingEnabled, isDeliveryZoneEnforcementEnabled, checkDeliveryZone,
  isLogisticsDistanceFeeEnabled, resolveDistanceDeliveryFee,
  isAffiliateEnabled, isInfluencerEnabled, isAffiliateVerified,
  stripeCreate, stripeRetrieve, stripeCancel, stripePk,
  computeFranchiseRoyalty, recordFranchiseRoyalty,
  recordCourierTipLedgerEntry, isLogisticsCourierAccrualEnabled,
} = vi.hoisted(() => ({
  db: {
    order:           { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    restaurant:      { findFirst: vi.fn(), findUnique: vi.fn() },
    creator:         { findFirst: vi.fn() },
    affiliate:       { findFirst: vi.fn() },
    referral:        { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralConfig:  { findFirst: vi.fn() },
    referralOrder:   { findUnique: vi.fn(), create: vi.fn() },
    dishAdoption:    { findMany: vi.fn() },
    dishSale:        { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:     { update: vi.fn() },
    adoptionConfig:  { findFirst: vi.fn() },
    loyaltyCustomer: { findUnique: vi.fn() },
    promoRedemption: { create: vi.fn() },
  },
  getToken:  vi.fn(),
  rateLimit: vi.fn(),
  loadHoursContext: vi.fn(), isOpenAtCtx: vi.fn(), nextOpeningCtx: vi.fn(), nextOpeningLabelFr: vi.fn(),
  computeApplicationFee: vi.fn(), resolveCommissionRate: vi.fn(),
  fetchActivePromotions: vi.fn(), pickBestPromotion: vi.fn(), resolveCodePromo: vi.fn(),
  commissionBaseCents: vi.fn(), commissionBaseMode: vi.fn(),
  resolveLoyaltyCredit: vi.fn(), estimateStripeFeeCents: vi.fn(), committedRoyaltyCents: vi.fn(),
  smallOrderFeeCents: vi.fn(), netBeforeAffiliateCents: vi.fn(),
  isTipsEnabled: vi.fn(), sanitizeTipCents: vi.fn(),
  isFranchisePosTaggingEnabled: vi.fn(), isDeliveryZoneEnforcementEnabled: vi.fn(), checkDeliveryZone: vi.fn(),
  isLogisticsDistanceFeeEnabled: vi.fn(), resolveDistanceDeliveryFee: vi.fn(),
  isAffiliateEnabled: vi.fn(), isInfluencerEnabled: vi.fn(), isAffiliateVerified: vi.fn(),
  // lib/stripe spies — the AUDIT core: stripeCreate captures the PI creation.
  stripeCreate: vi.fn(), stripeRetrieve: vi.fn(), stripeCancel: vi.fn(), stripePk: vi.fn(),
  computeFranchiseRoyalty: vi.fn(), recordFranchiseRoyalty: vi.fn(),
  recordCourierTipLedgerEntry: vi.fn(), isLogisticsCourierAccrualEnabled: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit }))
vi.mock('@/lib/opening-hours', () => ({ loadHoursContext, isOpenAtCtx, nextOpeningCtx, nextOpeningLabelFr }))
vi.mock('@/lib/commission', () => ({ computeApplicationFee, resolveCommissionRate }))
vi.mock('@/lib/promotions', () => ({
  fetchActivePromotions, pickBestPromotion, resolveCodePromo, commissionBaseCents, commissionBaseMode,
}))
vi.mock('@/lib/loyalty', () => ({ resolveLoyaltyCredit, estimateStripeFeeCents, committedRoyaltyCents }))
vi.mock('@/lib/pricing', () => ({ smallOrderFeeCents, netBeforeAffiliateCents }))
vi.mock('@/lib/tips', () => ({ isTipsEnabled, sanitizeTipCents }))
vi.mock('@/lib/franchise-pos-tagging', () => ({ isFranchisePosTaggingEnabled }))
vi.mock('@/lib/delivery-zone', () => ({ isDeliveryZoneEnforcementEnabled, checkDeliveryZone }))
vi.mock('@/lib/logistics-fee', () => ({ isLogisticsDistanceFeeEnabled, resolveDistanceDeliveryFee }))
vi.mock('@/lib/affiliate-account', () => ({ isAffiliateEnabled }))
vi.mock('@/lib/influencer-verification', () => ({ isInfluencerEnabled, isAffiliateVerified }))
// lib/stripe is fully mocked (mission rule: no real Stripe, no keys). eurosToCents
// keeps the REAL formula (pure, copied verbatim) so amounts stay faithful.
vi.mock('@/lib/stripe', () => ({
  createTicketPayment: stripeCreate,
  retrieveIntent:      stripeRetrieve,
  cancelIntent:        stripeCancel,
  getPublishableKey:   stripePk,
  eurosToCents:        (eur: number) => Math.round(eur * 100),
}))
vi.mock('@/lib/franchise-royalty', () => ({ computeFranchiseRoyalty, recordFranchiseRoyalty }))
vi.mock('@/lib/ledger', () => ({ recordCourierTipLedgerEntry }))
vi.mock('@/lib/courier-accrual', () => ({ isLogisticsCourierAccrualEnabled }))

import { POST as createOrder } from '@/app/api/orders/route'
import { POST as payOrder } from '@/app/api/orders/[id]/pay/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

// 2 × 10.00 € + 1.99 € delivery → total 21.99 €, pointsEarned = floor(21.99) = 21.
const cashBody = (over: Record<string, unknown> = {}) => ({
  restaurantId:    'r1',
  items:           [{ itemId: 'm1', name: 'Gnocchi maison', qty: 2, price: 10 }],
  deliveryAddress: '12 rue des Lilas, 75011 Paris',
  paymentMethod:   'cash',
  fulfillmentType: 'delivery',
  ...over,
})

const postOrder = (body: Record<string, unknown>) =>
  createOrder(
    new NextRequest('http://x/api/orders', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  )

const pay = (id: string, body?: Record<string, unknown>) =>
  payOrder(
    new NextRequest(`http://x/api/orders/${id}/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: { id } },
  )

// The cash order AS the /pay route's select returns it. Faithful to Prisma: the
// select does NOT include paymentMethod, so the returned row has no such key —
// the route is structurally blind to it (asserted below on the select itself).
const cashOrderRow = (over: Record<string, unknown> = {}) => ({
  id: 'ocash1', consumerId: 'c1', restaurantId: 'r1', status: 'received',
  subtotal: 20, deliveryFee: 1.99, total: 21.99, fulfillmentType: 'delivery',
  stripePaymentIntentId: null, paymentStatus: null, pointOfSaleId: null,
  ...over,
})

let lastCreateData: Record<string, unknown> = {}

beforeEach(() => {
  vi.clearAllMocks()
  lastCreateData = {}

  // Session: the consumer who owns the order.
  getToken.mockResolvedValue({ sub: 'c1', email: 'lea@x.fr', role: 'consumer' })
  rateLimit.mockReturnValue(null)

  // Creation-path collaborators — every flag OFF (prod defaults), no promo/referral.
  loadHoursContext.mockResolvedValue({ configured: false })
  fetchActivePromotions.mockResolvedValue([])
  computeApplicationFee.mockReturnValue(240)          // 12 % of 2000 cents (unused on plain cash)
  smallOrderFeeCents.mockReturnValue(0)
  isTipsEnabled.mockReturnValue(false)
  isFranchisePosTaggingEnabled.mockReturnValue(false)
  isDeliveryZoneEnforcementEnabled.mockReturnValue(false)
  isLogisticsDistanceFeeEnabled.mockReturnValue(false)
  isAffiliateEnabled.mockReturnValue(false)
  isInfluencerEnabled.mockReturnValue(false)
  db.restaurant.findFirst.mockResolvedValue({
    id: 'r1', isActive: true, archivedAt: null, deliveryFee: 1.99, minOrder: 10, pointOfSaleId: null,
  })
  db.dishAdoption.findMany.mockResolvedValue([])
  db.referral.findFirst.mockResolvedValue(null)
  db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    lastCreateData = data
    return { id: 'ocash1', ...data }
  })
  db.order.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    ({ id: 'ocash1', ...lastCreateData, ...data }))

  // Pay-path collaborators — resto NOT routed on Connect (A2 platform fallback),
  // exactly the simplest live path: no commission, fee 0.
  db.order.findUnique.mockResolvedValue(cashOrderRow())
  db.restaurant.findUnique.mockResolvedValue({
    stripeAccountId: null, stripeAccountStatus: null,
    commissionRateDineIn: null, commissionRatePickup: null,
    commissionRateDelivery: null, commissionFreeUntil: null,
  })
  commissionBaseCents.mockImplementation((subtotalCents: number) => subtotalCents)
  commissionBaseMode.mockReturnValue('discounted')
  resolveCommissionRate.mockReturnValue(0.12)
  isLogisticsCourierAccrualEnabled.mockReturnValue(false)
  stripePk.mockReturnValue('pk_test_mock')
  stripeCreate.mockResolvedValue({
    id: 'pi_mock_1', client_secret: 'pi_mock_1_secret_mock', status: 'requires_payment_method', amount: 2199,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ══════════════════════════════════════════════════════════════════════════════
// ACT 1 — cash order creation
// ══════════════════════════════════════════════════════════════════════════════

describe('P8 — commande CASH au checkout (POST /api/orders) — ÉTAT P0-02', () => {

  it('[PASS-ACTUEL P0-02] cash → 400 explicite (« seul le paiement par carte est accepté »), aucune commande créée, aucun PI', async () => {
    // INVERSION du photographiage Sprint 0 (« cash → 201 received ») : le refus
    // Q2 est désormais tenu par le SERVEUR — plus par la seule UI du panier.
    const res = await postOrder(cashBody())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('payment_method_unavailable')
    expect(json.error).toContain('seul le paiement par carte est accepté')
    expect(db.order.create).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("[PASS-ACTUEL P0-02] 'wallet' (valeur héritée de l'enum) → même refus 400, aucune commande créée", async () => {
    const res = await postOrder(cashBody({ paymentMethod: 'wallet' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('payment_method_unavailable')
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] contraste carte : paymentMethod « card » → statut initial « awaiting_payment » (invisible cuisine avant confirmation webhook)', async () => {
    // The ghost-orders fix only protects CARD orders — that is the exact contrast
    // making the cash 'received' path the kitchen-visible, payment-less one.
    const res = await postOrder(cashBody({ paymentMethod: 'card' }))
    expect(res.status).toBe(201)
    expect(lastCreateData.status).toBe('awaiting_payment')
  })

  it('[PASS-ACTUEL P0-02 — INVERSION des 2 FAIL-ATTENDU Sprint 0] plus AUCUN effet économique : ni trace fausse (paymentStatus null à vie) ni points provisionnés — zéro écriture DB sur un refus cash', async () => {
    // Sprint 0 photographed two audit defects on the cash CREATE path: a FALSE
    // economic trace (paymentStatus never initialized) and loyalty points
    // provisioned on a never-collected order. P0-02 removes the path itself —
    // the refusal happens BEFORE any write, so both defects are closed at the
    // root for NEW orders (legacy rows: see ACT 2 + the founder's SQL inventory).
    const res = await postOrder(cashBody())
    expect(res.status).toBe(400)
    expect(db.order.create).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
    expect(lastCreateData).toEqual({}) // no create payload ever captured
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ACT 2 — paying the CASH order by CARD (direct URL /eat/checkout/[orderId])
// ══════════════════════════════════════════════════════════════════════════════

describe('P8 — payer par CARTE une commande CASH (POST /api/orders/[id]/pay)', () => {

  // ── Guards that DO exist (photograph) ───────────────────────────────────────

  it('[PASS-ACTUEL] sans token → 401, aucun PaymentIntent', async () => {
    getToken.mockResolvedValue(null)
    const res = await pay('ocash1')
    expect(res.status).toBe(401)
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] commande d’un autre consommateur → 403 (owner-scope), aucun PaymentIntent', async () => {
    getToken.mockResolvedValue({ sub: 'someone-else' })
    const res = await pay('ocash1')
    expect(res.status).toBe(403)
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] gardes présents : déjà payée → 409, annulée → 400 — mais AUCUN garde sur paymentMethod', async () => {
    db.order.findUnique.mockResolvedValue(cashOrderRow({ paymentStatus: 'paid' }))
    let res = await pay('ocash1')
    expect(res.status).toBe(409)
    expect(stripeCreate).not.toHaveBeenCalled()

    db.order.findUnique.mockResolvedValue(cashOrderRow({ status: 'cancelled' }))
    res = await pay('ocash1')
    expect(res.status).toBe(400)
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  // ── The P8 core: the cash order is card-payable WITHOUT OBJECTION ───────────

  it('[FAIL-ATTENDU: PaymentIntent créé SANS OBJECTION sur une commande cash — double encaissement possible (espèces à la livraison + carte en ligne)] cash « received » → 201 + clientSecret', async () => {
    // AUDIT: the cash order is ALREADY visible to the kitchen ('received', ACT 1)
    // and will be collected in cash on delivery — yet /pay charges its FULL total
    // by card with zero objection. The route checks owner/paid/cancelled/minimum
    // only; paymentMethod is never considered. After the post-arbitrage fix, a
    // cash order must be REJECTED here (e.g. 409) or explicitly converted to
    // card — this test must then be INVERTED.
    const res = await pay('ocash1')
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      clientSecret: 'pi_mock_1_secret_mock', publishableKey: 'pk_test_mock', amount: 2199, currency: 'eur',
    })
    expect(stripeCreate).toHaveBeenCalledTimes(1)
    expect(stripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      amountCents:    2199,             // the CASH order's full total, charged by card
      currency:       'eur',
      metadata:       { restaurantId: 'r1' },
      connect:        undefined,        // resto not routed → bare platform PI (A2 fallback)
      idempotencyKey: 'orderpay-ocash1-2199-0-first',
    }))
  })

  it('[FAIL-ATTENDU: paymentMethod même pas LU par la route — le garde cash est structurellement impossible] le select Prisma de /pay ne contient pas paymentMethod', async () => {
    // AUDIT: the route's findUnique select enumerates id/consumerId/restaurantId/
    // status/amount fields/stripePaymentIntentId/paymentStatus/pointOfSaleId —
    // paymentMethod is ABSENT, so no code path in /pay can even observe that the
    // order is cash. The fix must first READ it, then guard on it.
    const res = await pay('ocash1')
    expect(res.status).toBe(201)
    const firstFind = db.order.findUnique.mock.calls[0][0] as { select: Record<string, unknown> }
    expect('paymentMethod' in firstFind.select).toBe(false)
    // The guards the route DOES base itself on are selected (photograph):
    expect(firstFind.select.paymentStatus).toBe(true)
    expect(firstFind.select.status).toBe(true)
    expect(firstFind.select.consumerId).toBe(true)
  })

  it('[FAIL-ATTENDU: requalification silencieuse — paymentStatus passe à « pending » + PI stocké, mais paymentMethod reste « cash »] l’update n’écrit QUE { stripePaymentIntentId, paymentStatus }', async () => {
    // AUDIT: after /pay, the DB row says paymentMethod='cash' AND carries a live
    // card PaymentIntent with paymentStatus='pending' (then 'paid' via webhook) —
    // two contradictory truths on the same order; the kitchen/courier still see a
    // cash order to collect. The fix must reconcile paymentMethod when a card
    // payment is initiated on a cash order (or forbid it) — this exact-payload
    // assertion will then need updating.
    const res = await pay('ocash1')
    expect(res.status).toBe(201)
    expect(db.order.update).toHaveBeenCalledTimes(1)
    // Deep equality on the FULL argument proves paymentMethod is NOT reconciled.
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'ocash1' },
      data:  { stripePaymentIntentId: 'pi_mock_1', paymentStatus: 'pending' },
    })
  })

  it('[PASS-ACTUEL] montant fixé côté SERVEUR : le body de la requête est ignoré — un « amount » client ne change rien', async () => {
    // Anti-fraud invariant worth photographing: /pay never parses the request
    // body; the charge is always order.total read server-side.
    const res = await pay('ocash1', { amount: 1, total: 0.01 })
    expect(res.status).toBe(201)
    expect(stripeCreate).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 2199 }))
  })

  // ── Non-testable in this node harness ───────────────────────────────────────

  it.skipIf(!hasStripe)(
    '[NON-TESTABLE: clés Stripe absentes en CI — présence testée seulement, valeur jamais affichée] avec STRIPE_SECRET_KEY présent, la commande cash est toujours acceptée (garde indépendant de la clé)',
    async () => {
      // The no-objection behavior is key-INDEPENDENT (the guard logic never touches
      // the key; lib/stripe is mocked). Runs only when a key exists locally.
      const res = await pay('ocash1')
      expect(res.status).toBe(201)
      expect(stripeCreate).toHaveBeenCalledTimes(1)
    },
  )

  it.todo('[NON-TESTABLE: UI navigateur] URL directe /eat/checkout/[orderId] : la page de paiement carte s’ouvre pour une commande cash (app/[locale]/eat/checkout/[orderId]/page.tsx) — parcours navigateur hors harnais node')
})
