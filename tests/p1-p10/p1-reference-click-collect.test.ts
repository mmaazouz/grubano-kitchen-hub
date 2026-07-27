import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ══════════════════════════════════════════════════════════════════════════════
// P1 RÉFÉRENCE — successful CARD order in CLICK & COLLECT, end to end.
// CHARACTERIZATION tests (Sprint 0): every test asserts the CURRENT behavior of
// the code — even where the audit flagged it — so the suite is GREEN today.
//   • POST  /api/orders                 → creation (fulfillmentType 'pickup')
//   • PATCH /api/orders/[id]/status     → REAL state machine + loyalty credit + emails
//   • GET   /api/orders/[id]            → consumer tracking
// Route handlers are imported directly and driven with mocked prisma / next-auth
// (no real DB — repo harness convention, see tests/ghost-orders.test.ts and
// tests/loyalty-auto-account.test.ts whose mock patterns are reproduced here).
//
// AUDIT NOTE (écart vs the announced verdict): the loyalty credit at 'delivered'
// does NOT go through loyaltyCustomer.updateMany anymore (stale CLAUDE.md). The
// real mechanism is: loyaltyCustomer.UPSERT by email (create at 0 pts if absent)
// then $transaction([pointsBalance increment, loyaltyTransaction 'earn' row]),
// idempotent per order. The tests below encode THAT mechanism.
// ══════════════════════════════════════════════════════════════════════════════

// Real card payment needs Stripe TEST keys — presence check ONLY, never a value.
const hasStripe = !!process.env.STRIPE_SECRET_KEY

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:         { findFirst: vi.fn(), findUnique: vi.fn() },
    creator:            { findFirst: vi.fn() },
    referralConfig:     { findFirst: vi.fn() },
    referral:           { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralOrder:      { findUnique: vi.fn(), create: vi.fn() },
    order:              { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    promotion:          { findMany: vi.fn(), findUnique: vi.fn() },
    dishAdoption:       { findMany: vi.fn() },
    dishSale:           { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:        { update: vi.fn() },
    adoptionConfig:     { findFirst: vi.fn() },
    openingHour:        { findMany: vi.fn() },
    closureException:   { findMany: vi.fn() },
    operator:           { findUnique: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    $transaction:       vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

// Establishment ownership helper (hardening pre-condition of PATCH/GET). Mocked
// as a controllable fn so per-test scoping (own resto / foreign resto / consumer
// 403) can be exercised — same pattern as tests/order-refund.test.ts.
const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

// Status email sender (B1 rail) — mocked so the tests characterize WHEN the route
// triggers it (post-update, best-effort). The lib itself is already characterized
// by tests/email-order-status.test.ts.
const { emailMock } = vi.hoisted(() => ({ emailMock: vi.fn() }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: emailMock }))

import { POST as createOrder } from '@/app/api/orders/route'
import { PATCH as patchStatus } from '@/app/api/orders/[id]/status/route'
import { GET as getOrder } from '@/app/api/orders/[id]/route'

// ── Request helpers ───────────────────────────────────────────────────────────

const orderReq = (body: Record<string, unknown>) =>
  new NextRequest('https://app.grubano.com/api/orders', {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const orderBody = (over: Record<string, unknown> = {}) => ({
  restaurantId:    'rest1',
  items:           [{ itemId: 'i1', name: 'Gnocchi', qty: 1, price: 20, options: [] }],
  deliveryAddress: 'Retrait sur place — 12 rue de la Paix',
  paymentMethod:   'card',
  fulfillmentType: 'pickup',
  ...over,
})

const statusReq = (status: string) =>
  new NextRequest('https://app.grubano.com/api/orders/order1/status', {
    method:  'PATCH',
    body:    JSON.stringify({ status }),
    headers: { 'content-type': 'application/json' },
  })

const patchTo = (status: string) => patchStatus(statusReq(status), { params: { id: 'order1' } })

const trackReq = () => new NextRequest('https://app.grubano.com/api/orders/order1')
const track    = () => getOrder(trackReq(), { params: { id: 'order1' } })

// A pickup order row as stored between transitions (fed to order.findUnique).
const pickupOrder = (over: Record<string, unknown> = {}) => ({
  id: 'order1', consumerId: 'cust1', restaurantId: 'rest1',
  status: 'received', fulfillmentType: 'pickup', pointsEarned: 0,
  ...over,
})

// The full row read by GET /api/orders/[id] (include restaurant).
const trackedOrder = (over: Record<string, unknown> = {}) => ({
  id: 'order1', consumerId: 'cust1', restaurantId: 'rest1',
  status: 'preparing', fulfillmentType: 'pickup',
  items:    [{ itemId: 'i1', name: 'Gnocchi', qty: 1, price: 20, options: [] }],
  subtotal: 20, deliveryFee: 0, total: 20, discount: 0, promotionId: null,
  loyaltyCreditCents: 0, pointsRedeemed: 0, tipCents: 0,
  estimatedTime: 30, trackingUrl: 'https://track.grubano.com/order/order1',
  deliveryAddress: 'Retrait sur place — 12 rue de la Paix',
  paymentMethod: 'card', paymentStatus: 'paid', pointsEarned: 20,
  createdAt: new Date(0), updatedAt: new Date(0),
  restaurant: { id: 'rest1', name: 'Gnocchi Bar', logo: null, address: '1 rue X', city: 'Paris', deliveryTime: 20 },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  // Default caller = the consumer who owns order1. PATCH describes override this
  // with a restaurant-operator token.
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'consumer' })
  scopeMock.mockResolvedValue({
    ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['rest1'], restaurantId: 'rest1',
  })
  db.restaurant.findFirst.mockResolvedValue({
    id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10,
    commissionRateDineIn: null, commissionRatePickup: null,
    commissionRateDelivery: null, commissionFreeUntil: null,
  })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
  db.openingHour.findMany.mockResolvedValue([])       // hours not configured → no gate
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null)        // no referral code / chef cookie
  db.promotion.findMany.mockResolvedValue([])         // no active promotion
  db.dishAdoption.findMany.mockResolvedValue([])      // no adopted dish
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', status: 'awaiting_payment', updatedAt: new Date(0) })
  // Loyalty + email collaborators of the PATCH route (best-effort blocks).
  db.operator.findUnique.mockResolvedValue({ email: 'buyer@example.com', name: 'Buyer' })
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.loyaltyCustomer.upsert.mockResolvedValue({ id: 'lc1' })
  db.loyaltyCustomer.update.mockResolvedValue({ id: 'lc1' })
  db.loyaltyTransaction.create.mockResolvedValue({ id: 'tx1' })
  db.$transaction.mockResolvedValue([])
  emailMock.mockResolvedValue({ status: 'sent' })
})

// ══════════════════════════════════════════════════════════════════════════════
// P1 — POST /api/orders — création click & collect (carte)
// ══════════════════════════════════════════════════════════════════════════════

describe('P1 — POST /api/orders (création click & collect, carte)', () => {
  it('[PASS-ACTUEL] 401 sans session — la création de commande exige une authentification', async () => {
    // NOTE: CLAUDE.md documents this route as "session/public" — the code is
    // session-ONLY today. Reported as a doc écart, not a code change.
    getTokenMock.mockResolvedValue(null)
    const res = await createOrder(orderReq(orderBody()))
    expect(res.status).toBe(401)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it("[PASS-ACTUEL] pickup + carte : créée 'awaiting_payment' (invisible resto avant webhook), deliveryFee 0, fulfillmentType persisté", async () => {
    const res = await createOrder(orderReq(orderBody()))
    expect(res.status).toBe(201)
    const created = (db.order.create.mock.calls[0]?.[0] as any)?.data
    expect(created).toMatchObject({
      consumerId:      'cust1',
      restaurantId:    'rest1',
      status:          'awaiting_payment', // ghost-orders fix: webhook reveals it
      fulfillmentType: 'pickup',
      deliveryFee:     0,                  // click & collect NEVER pays the €1.99
      paymentMethod:   'card',
      subtotal:        20,
      total:           20,
      referralCode:    null,
    })
  })

  it('[PASS-ACTUEL] réponse : total 20 €, pointsEarned = floor(total nourriture) = 20, aucun frais petite commande (subtotal ≥ 12 €)', async () => {
    const res  = await createOrder(orderReq(orderBody()))
    const body = await res.json()
    expect(body).toMatchObject({
      orderId:       'order1',
      total:         20,
      pointsEarned:  20,  // 1 pt / € on the food total (delivery fee = 0 on pickup)
      discount:      0,
      smallOrderFee: 0,   // 20 € ≥ the 12 € threshold
      tip:           0,
      loyaltyCredit: 0,
      pointsRedeemed: 0,
    })
  })

  it("[PASS-ACTUEL] pickup + espèces : créée 'received' directement (pas de paiement en ligne → visible immédiatement)", async () => {
    const res = await createOrder(orderReq(orderBody({ paymentMethod: 'cash' })))
    expect(res.status).toBe(201)
    const created = (db.order.create.mock.calls[0]?.[0] as any)?.data
    expect(created.status).toBe('received')
  })

  it('[PASS-ACTUEL] sous le minimum de commande → 400 (contrôlé sur le subtotal AVANT remises)', async () => {
    const res = await createOrder(orderReq(orderBody({
      items: [{ itemId: 'i1', name: 'Gnocchi', qty: 1, price: 5, options: [] }], // 5 € < minOrder 10 €
    })))
    expect(res.status).toBe(400)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] restaurant introuvable / inactif / archivé → 404', async () => {
    db.restaurant.findFirst.mockResolvedValue(null)
    const res = await createOrder(orderReq(orderBody()))
    expect(res.status).toBe(404)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] payload invalide (adresse < 5 caractères) → 400 Zod', async () => {
    const res = await createOrder(orderReq(orderBody({ deliveryAddress: 'abc' })))
    expect(res.status).toBe(400)
    expect(db.order.create).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// P1 — PATCH /api/orders/[id]/status — la machine d'états RÉELLE côté resto
//   received → preparing → ready → (picked_up →) delivered ; * → cancelled sauf
//   picked_up/terminaux (voir FAIL-ATTENDU).
// ══════════════════════════════════════════════════════════════════════════════

describe("P1 — PATCH /api/orders/[id]/status (machine d'états)", () => {
  beforeEach(() => {
    // Operator token: only 'restaurant' / 'admin' may drive the machine.
    getTokenMock.mockResolvedValue({ sub: 'op1', role: 'restaurant' })
  })

  it('[PASS-ACTUEL] chaîne click & collect complète : received→preparing→ready→delivered, chaque étape 200', async () => {
    const chain: Array<[string, string]> = [
      ['received',  'preparing'],
      ['preparing', 'ready'],
      ['ready',     'delivered'], // pickup hand-off: NO courier leg (ghost-orders 2.4)
    ]
    for (const [from, to] of chain) {
      db.order.findUnique.mockResolvedValue(pickupOrder({ status: from }))
      db.order.update.mockResolvedValue({ id: 'order1', status: to, updatedAt: new Date(0) })
      const res = await patchTo(to)
      expect(res.status, `${from} → ${to}`).toBe(200)
      expect((await res.json()).status).toBe(to)
    }
  })

  it('[PASS-ACTUEL] la branche livraison ready→picked_up→delivered reste valide (non touchée par le raccourci pickup)', async () => {
    for (const [from, to] of [['ready', 'picked_up'], ['picked_up', 'delivered']] as const) {
      db.order.findUnique.mockResolvedValue(pickupOrder({ status: from, fulfillmentType: 'delivery' }))
      db.order.update.mockResolvedValue({ id: 'order1', status: to, updatedAt: new Date(0) })
      expect((await patchTo(to)).status, `${from} → ${to}`).toBe(200)
    }
  })

  it('[PASS-ACTUEL] transitions hors machine → 422 avec la liste des transitions permises', async () => {
    const refused: Array<[string, string]> = [
      ['received',  'ready'],      // no skipping the kitchen
      ['received',  'delivered'],
      ['received',  'picked_up'],
      ['preparing', 'delivered'],
      ['preparing', 'picked_up'],
      ['ready',     'received'],   // no going backwards
      ['picked_up', 'ready'],
      ['delivered', 'cancelled'],  // terminal
      ['delivered', 'preparing'],  // terminal
      ['cancelled', 'preparing'],  // terminal
    ]
    for (const [from, to] of refused) {
      db.order.findUnique.mockResolvedValue(pickupOrder({ status: from }))
      const res = await patchTo(to)
      expect(res.status, `${from} → ${to}`).toBe(422)
    }
    // The 422 body names the invalid transition and lists what IS allowed.
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'received' }))
    const body = await (await patchTo('delivered')).json()
    expect(body.error).toContain('Transition invalide')
    expect(body.allowed).toEqual(['preparing', 'cancelled'])
  })

  it("[PASS-ACTUEL] 'awaiting_payment' est HORS machine : aucun PATCH possible (422) — seul le webhook Stripe révèle la commande", async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'awaiting_payment' }))
    const res = await patchTo('received')
    expect(res.status).toBe(422)
    expect((await res.json()).allowed).toEqual(['(aucune transition possible)'])
  })

  it('[PASS-ACTUEL] annulation possible depuis received / preparing / ready (côté resto)', async () => {
    for (const from of ['received', 'preparing', 'ready']) {
      db.order.findUnique.mockResolvedValue(pickupOrder({ status: from }))
      db.order.update.mockResolvedValue({ id: 'order1', status: 'cancelled', updatedAt: new Date(0) })
      expect((await patchTo('cancelled')).status, `${from} → cancelled`).toBe(200)
    }
  })

  // AUDIT: the route header comment claims "any state → cancelled" but the
  // TRANSITIONS table has picked_up: ['delivered'] only — an order already picked
  // up CANNOT be cancelled today (422). If arbitrage decides the comment is the
  // spec (cancel from picked_up allowed), INVERT this test after the fix.
  it("[FAIL-ATTENDU: l'en-tête annonce « any state → cancelled » mais picked_up→cancelled est refusé] picked_up→cancelled → 422 aujourd'hui", async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'picked_up' }))
    expect((await patchTo('cancelled')).status).toBe(422)
  })

  it('[PASS-ACTUEL] rôle non restaurateur/admin (consumer) → 403', async () => {
    getTokenMock.mockResolvedValue({ sub: 'cust1', role: 'consumer' })
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'received' }))
    expect((await patchTo('preparing')).status).toBe(403)
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it("[PASS-ACTUEL] commande d'un autre établissement → 404 (existence masquée, anti-IDOR)", async () => {
    scopeMock.mockResolvedValue({
      ok: true, operatorId: 'op2', role: 'restaurant', ownedIds: ['rest9'], restaurantId: 'rest9',
    })
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'received' }))
    expect((await patchTo('preparing')).status).toBe(404)
    expect(db.order.update).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// P1 — points fidélité : crédités à 'delivered', et UNIQUEMENT là
//   Mechanism (current code, NOT loyaltyCustomer.updateMany): upsert by email
//   (create at 0 pts) then $transaction([balance increment, 'earn' ledger row]).
// ══════════════════════════════════════════════════════════════════════════════

describe("P1 — points fidélité au passage 'delivered'", () => {
  beforeEach(() => {
    getTokenMock.mockResolvedValue({ sub: 'op1', role: 'restaurant' })
  })

  it("[PASS-ACTUEL] à 'delivered' : upsert LoyaltyCustomer par email + incrément pointsEarned + ligne 'earn' dans UNE transaction", async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'picked_up', fulfillmentType: 'delivery', pointsEarned: 20 }))
    db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date(0) })

    const res = await patchTo('delivered')
    expect(res.status).toBe(200)

    // Account ensured by EMAIL, created at 0 pts (welcome bonus stays opt-in only).
    const upsertArg = db.loyaltyCustomer.upsert.mock.calls[0]?.[0] as any
    expect(upsertArg.where).toEqual({ email: 'buyer@example.com' })
    expect(upsertArg.create.pointsBalance).toBe(0)
    // Credit = EXACTLY Order.pointsEarned, atomically with the signed 'earn' row.
    expect(db.loyaltyCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lc1' }, data: { pointsBalance: { increment: 20 } } }),
    )
    expect(db.loyaltyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: 'lc1', orderId: 'order1', type: 'earn', points: 20 }) }),
    )
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    // The CURRENT mechanism never calls updateMany (stale audit/CLAUDE.md claim).
    expect(db.loyaltyCustomer.updateMany).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] la remise en main propre pickup (ready→delivered) crédite AUSSI les points', async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'ready', pointsEarned: 20 }))
    db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date(0) })

    expect((await patchTo('delivered')).status).toBe(200)
    expect(db.loyaltyCustomer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pointsBalance: { increment: 20 } } }),
    )
  })

  it("[PASS-ACTUEL] idempotent : une ligne 'earn' déjà présente pour la commande → aucun re-crédit", async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'ready', pointsEarned: 20 }))
    db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date(0) })
    db.loyaltyTransaction.findFirst.mockResolvedValue({ id: 'prior-earn' })

    expect((await patchTo('delivered')).status).toBe(200)
    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.update).not.toHaveBeenCalled()
    expect(db.loyaltyTransaction.create).not.toHaveBeenCalled()
  })

  it("[PASS-ACTUEL] aucun crédit AVANT 'delivered' — preparing→ready n'écrit rien côté fidélité", async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'preparing', pointsEarned: 20 }))
    db.order.update.mockResolvedValue({ id: 'order1', status: 'ready', updatedAt: new Date(0) })

    expect((await patchTo('ready')).status).toBe(200)
    expect(db.loyaltyTransaction.findFirst).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
  })

  it("[PASS-ACTUEL] best-effort : un échec fidélité ne bloque jamais la transition 'delivered'", async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'ready', pointsEarned: 20 }))
    db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date(0) })
    db.loyaltyCustomer.upsert.mockRejectedValue(new Error('table missing'))

    const res = await patchTo('delivered')
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('delivered')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// P1 — emails de statut (déclenchement route ; le contenu est caractérisé par
// tests/email-order-status.test.ts sur la lib elle-même)
// ══════════════════════════════════════════════════════════════════════════════

describe('P1 — emails de statut consommateur', () => {
  beforeEach(() => {
    getTokenMock.mockResolvedValue({ sub: 'op1', role: 'restaurant' })
  })

  it('[PASS-ACTUEL] chaque PATCH déclenche sendOrderStatusEmail avec le NOUVEAU statut + fulfillmentType, vers le consommateur', async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'received' }))
    db.order.update.mockResolvedValue({ id: 'order1', status: 'preparing', updatedAt: new Date(0) })

    expect((await patchTo('preparing')).status).toBe(200)
    expect(emailMock).toHaveBeenCalledTimes(1)
    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId:         'order1',
      to:              'buyer@example.com',
      restaurantName:  'Gnocchi Bar',
      status:          'preparing',
      fulfillmentType: 'pickup', // drives the « récupérer » vs « livrée » wording
    }))
  })

  it("[PASS-ACTUEL] best-effort : un échec d'envoi ne fait jamais échouer la transition", async () => {
    db.order.findUnique.mockResolvedValue(pickupOrder({ status: 'ready' }))
    db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date(0) })
    emailMock.mockRejectedValue(new Error('smtp down'))

    expect((await patchTo('delivered')).status).toBe(200)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// P1 — GET /api/orders/[id] — suivi client
// ══════════════════════════════════════════════════════════════════════════════

describe('P1 — GET /api/orders/[id] (suivi client)', () => {
  it('[PASS-ACTUEL] 401 sans session — le suivi exige une authentification', async () => {
    getTokenMock.mockResolvedValue(null)
    expect((await track()).status).toBe(401)
  })

  it('[PASS-ACTUEL] le consommateur propriétaire lit sa commande : statut, fulfillmentType pickup, totaux et points exposés', async () => {
    db.order.findUnique.mockResolvedValue(trackedOrder())
    const res = await track()
    expect(res.status).toBe(200)
    const { order } = await res.json()
    expect(order).toMatchObject({
      id:              'order1',
      status:          'preparing',
      fulfillmentType: 'pickup', // drives the whole /eat/track UI (no courier map)
      subtotal:        20,
      deliveryFee:     0,
      total:           20,
      pointsEarned:    20,
      tipCents:        0,
      paymentStatus:   'paid',
    })
    expect(order.restaurant).toMatchObject({ id: 'rest1', name: 'Gnocchi Bar' })
    // Owner path: the establishment-scope helper is never consulted.
    expect(scopeMock).not.toHaveBeenCalled()
    // No courier position while the kitchen prepares (mock returns null here).
    expect(order.driverLocation).toBeNull()
  })

  it('[PASS-ACTUEL] commande inexistante → 404', async () => {
    db.order.findUnique.mockResolvedValue(null)
    expect((await track()).status).toBe(404)
  })

  // AUDIT: a FOREIGN consumer gets 403 (helper refuses non-operator roles) while
  // staff cross-tenant and missing ids get 404 — so an authenticated consumer can
  // distinguish "exists" (403) from "does not exist" (404): an order-id existence
  // oracle. Behavior explicitly preserved by the route comment ("preserving the
  // old behaviour"). If arbitrage aligns it on 404, INVERT this test.
  it("[FAIL-ATTENDU: 403 (pas 404) pour un consommateur étranger → oracle d'existence d'id de commande] un autre consommateur reçoit 403", async () => {
    getTokenMock.mockResolvedValue({ sub: 'otherCust', email: 'x@y.z', role: 'consumer' })
    // Mirrors the REAL resolveEstablishmentScope contract for a consumer role:
    // { ok: false, status: 403 } (documented in the route's own comment).
    scopeMock.mockResolvedValue({ ok: false, status: 403, error: 'Accès refusé' })
    db.order.findUnique.mockResolvedValue(trackedOrder())
    expect((await track()).status).toBe(403)
  })

  it("[PASS-ACTUEL] staff d'un autre établissement → 404 (existence masquée) — contraste avec le 403 consommateur", async () => {
    getTokenMock.mockResolvedValue({ sub: 'op2', role: 'restaurant' })
    scopeMock.mockResolvedValue({
      ok: true, operatorId: 'op2', role: 'restaurant', ownedIds: ['rest9'], restaurantId: 'rest9',
    })
    db.order.findUnique.mockResolvedValue(trackedOrder())
    expect((await track()).status).toBe(404)
  })

  // AUDIT: driverLocation is FABRICATED server-side (mockDriverLocation — fixed
  // Paris coords at 'delivered', Math.random around them at 'picked_up'): Uber
  // Direct is not wired. It is served even for a PICKUP order, where no courier
  // ever existed (the UI merely ignores it thanks to fulfillmentType). After the
  // real courier feed lands, INVERT/rewrite this test.
  it("[FAIL-ATTENDU: driverLocation = mock aléatoire (Uber Direct non branché), servie même en pickup] pickup 'delivered' expose des coordonnées livreur factices", async () => {
    db.order.findUnique.mockResolvedValue(trackedOrder({ status: 'delivered' }))
    const { order } = await (await track()).json()
    expect(order.fulfillmentType).toBe('pickup')
    expect(order.driverLocation).toEqual({ lat: 48.8566, lng: 2.3522, bearing: 0 })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// P1 — NON-TESTABLE sans clés Stripe / hors périmètre route
// ══════════════════════════════════════════════════════════════════════════════

describe('P1 — paiement carte réel + suivi UI (non testables ici)', () => {
  // Runs ONLY when a Stripe TEST key is present in the environment (presence
  // check only — the value is never read past truthiness, never printed).
  it.skipIf(!hasStripe)(
    "[NON-TESTABLE: STRIPE_SECRET_KEY absente] paiement carte réel — PaymentIntent /pay + webhook payment_intent.succeeded (awaiting_payment→received)",
    () => {
      // Placeholder: the real-money leg (PI creation, webhook signature, the
      // awaiting_payment→received flip) needs the Stripe TEST keys + fixtures.
      // To be fleshed out when the keys land in the QA env (cf. P1-carte replay).
      expect(hasStripe).toBe(true)
    },
  )

  it.todo("[NON-TESTABLE: UI navigateur] /eat/track/[orderId] — polling 15 s et rendu pickup côté client")
})
