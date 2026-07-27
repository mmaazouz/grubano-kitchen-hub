import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P3 — Sprint 0 characterization: restaurant cancels a PAID order ───────────
// PATCH /api/orders/[id]/status → 'cancelled' on an order with paymentStatus='paid'.
//
// These are CHARACTERIZATION tests: they photograph the CURRENT behavior of
// app/api/orders/[id]/status/route.ts, bugs included. The suite must be GREEN
// today. Nothing is fixed here.
//
// What the route ACTUALLY does on cancellation (read on branch sprint0-prep):
//   - auth: getToken + role ∈ {restaurant, admin}, then establishment-ownership
//     scope (resolveEstablishmentScope) — foreign order → 404.
//   - state machine: received/preparing/ready → cancelled allowed; picked_up,
//     delivered and cancelled can NOT go to cancelled (422).
//   - the update writes ONLY { status: 'cancelled' } — paymentStatus is never
//     read nor written, no cancellation reason/timestamp is persisted.
//   - NO refund path: the route imports neither '@/lib/refunds' (refundPayment)
//     nor '@/lib/refund' (executeRefund) — money stays captured (audit verdict
//     CONFIRMED by the code).
//   - loyalty: the points block only runs when newStatus === 'delivered', so a
//     cancellation writes nothing loyalty-side (nothing was credited yet).
//   - email: sendOrderStatusEmail(status:'cancelled') is attempted POST-update,
//     best-effort (a failure never blocks the 200).

const hasStripe = !!process.env.STRIPE_SECRET_KEY // presence only — value never shown

const { db, getToken, resolveScope, sendEmail, refundPayment, executeRefund } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    $transaction:       vi.fn(),
  },
  getToken:      vi.fn(),
  resolveScope:  vi.fn(),
  sendEmail:     vi.fn(),
  refundPayment: vi.fn(), // spy on '@/lib/refunds' — must stay UNCALLED (that IS the audit finding)
  executeRefund: vi.fn(), // spy on '@/lib/refund'  — idem
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: sendEmail }))
// Both refund libs are mocked so that ANY (even transitive) call would be captured.
// Today the route imports NEITHER — the spies must therefore never fire.
vi.mock('@/lib/refunds', () => ({ refundPayment }))
vi.mock('@/lib/refund', () => ({
  executeRefund,
  isRefundsEnabled:   vi.fn(() => false),
  computeRefundSplit: vi.fn(),
}))

import { PATCH } from '@/app/api/orders/[id]/status/route'

const patch = (id: string, body: Record<string, unknown>) =>
  PATCH(
    new NextRequest(`http://x/api/orders/${id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    { params: { id } },
  )

const scopeOk = (over: Record<string, unknown> = {}) => ({
  ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1', ...over,
})

// A PAID order, owned by the calling restaurant — the P3 subject.
const paidOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1', status: 'received', restaurantId: 'r1', consumerId: 'c1',
  paymentStatus: 'paid', total: 42.5, pointsEarned: 8, fulfillmentType: 'delivery',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue(scopeOk())
  db.order.findUnique.mockResolvedValue(paidOrder())
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) =>
    Promise.resolve({ id: 'o1', status: data.status, updatedAt: new Date('2026-07-27T10:00:00Z') }))
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue(null)   // → loyalty + email lookups skip cleanly
  db.restaurant.findUnique.mockResolvedValue(null)
  sendEmail.mockResolvedValue({ status: 'sent' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('P3 — annulation resto d’une commande PAYÉE (PATCH /api/orders/[id]/status → cancelled)', () => {

  // ── Guards ──────────────────────────────────────────────────────────────────

  it('[PASS-ACTUEL] sans token → 401, aucune écriture, aucun refund, aucun email', async () => {
    getToken.mockResolvedValue(null)
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(401)
    expect(db.order.update).not.toHaveBeenCalled()
    expect(refundPayment).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] rôle consumer → 403 — le client ne peut PAS annuler sa commande via cette route', async () => {
    getToken.mockResolvedValue({ role: 'consumer' })
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(403)
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] commande d’un autre restaurant → 404, aucune écriture (IDOR fermé)', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ id: 'oX', restaurantId: 'foreign-resto' }))
    const res = await patch('oX', { status: 'cancelled' })
    expect(res.status).toBe(404)
    expect(db.order.update).not.toHaveBeenCalled()
  })

  // ── The P3 core: cancel a PAID order ───────────────────────────────────────

  it('[PASS-ACTUEL] resto annule une commande payée (received) → 200, statut final « cancelled »', async () => {
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ orderId: 'o1', status: 'cancelled' })
  })

  it('[FAIL-ATTENDU: AUCUN remboursement automatique à l’annulation d’une commande payée] lib/refunds et lib/refund ne sont JAMAIS appelés', async () => {
    // AUDIT: the order is paid (paymentStatus='paid', total=42.50) yet cancelling it
    // triggers NO refund — the route imports neither refundPayment ('@/lib/refunds')
    // nor executeRefund ('@/lib/refund'). The consumer's money stays captured with no
    // compensating flow. After the post-arbitrage fix (auto-refund or an explicit
    // refund task on cancellation of a paid order), this test must be INVERTED
    // (expect the refund path to have been called).
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(refundPayment).not.toHaveBeenCalled()
    expect(executeRefund).not.toHaveBeenCalled()
  })

  it('[FAIL-ATTENDU: paymentStatus jamais relu ni modifié — l’argent reste « paid » après annulation] l’update n’écrit QUE { status }', async () => {
    // AUDIT: the route never reads order.paymentStatus (no branch on paid/unpaid) and
    // the update payload is exactly { status: 'cancelled' } — no paymentStatus flip
    // (e.g. → 'refund_pending'), no cancellation reason, no cancelledAt timestamp
    // (Order has no such fields — see H1-H5 audit "Order sans timestamps/motifs").
    // After the fix, cancellation of a paid order should leave a money-side trace;
    // this exact-payload assertion will then need to be updated.
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    // Deep-equality on the FULL argument proves data contains ONLY { status }.
    expect(db.order.update).toHaveBeenCalledTimes(1)
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data:  { status: 'cancelled' },
    })
  })

  it('[PASS-ACTUEL] aucune écriture fidélité à l’annulation — les points ne sont crédités qu’à « delivered », rien à reprendre', async () => {
    // Loyalty block is gated on newStatus === 'delivered'; since delivered is terminal
    // (delivered → cancelled is impossible), a cancellation can never claw back points
    // — and indeed writes nothing loyalty-side.
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(db.loyaltyTransaction.findFirst).not.toHaveBeenCalled()
    expect(db.loyaltyTransaction.create).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  // ── Cancellation email ─────────────────────────────────────────────────────

  it('[PASS-ACTUEL] email d’annulation tenté vers le consommateur (sendOrderStatusEmail status=cancelled), sans montant', async () => {
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      orderId:        'o1',
      to:             'lea@x.fr',
      status:         'cancelled',
      restaurantName: 'Gnocchi Bar',
    }))
    // The route hands NO amount to the email layer (status-only email) — consistent
    // with the audit: the cancellation email says nothing about a refund.
    const arg = sendEmail.mock.calls[0][0] as Record<string, unknown>
    expect('total' in arg || 'amount' in arg).toBe(false)
  })

  it('[PASS-ACTUEL] échec de l’email d’annulation NON bloquant → 200 quand même (best-effort)', async () => {
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    sendEmail.mockRejectedValue(new Error('smtp down'))
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'cancelled' })
  })

  // ── State machine around 'cancelled' (paid orders included) ────────────────

  it('[PASS-ACTUEL] preparing → cancelled et ready → cancelled autorisés, même payées (200)', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ status: 'preparing' }))
    let res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)

    db.order.findUnique.mockResolvedValue(paidOrder({ status: 'ready' }))
    res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
  })

  it('[PASS-ACTUEL] picked_up → cancelled refusé (422) — plus d’annulation une fois en route, même payée', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ status: 'picked_up' }))
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(422)
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] états terminaux — delivered → cancelled et cancelled → cancelled refusés (422)', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ status: 'delivered' }))
    let res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(422)

    db.order.findUnique.mockResolvedValue(paidOrder({ status: 'cancelled' }))
    res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(422)
    expect(db.order.update).not.toHaveBeenCalled()
  })

  // ── Non-testable in this node harness ──────────────────────────────────────

  it.skipIf(!hasStripe)(
    '[NON-TESTABLE: clés Stripe absentes en CI — comportement identique attendu avec clés] même avec STRIPE_SECRET_KEY présent, l’annulation paid ne déclenche aucun refund',
    async () => {
      // The no-refund behavior is key-INDEPENDENT (the route has zero Stripe code
      // path). Runs only when a Stripe key is present locally; skipped in CI.
      const res = await patch('o1', { status: 'cancelled' })
      expect(res.status).toBe(200)
      expect(refundPayment).not.toHaveBeenCalled()
      expect(executeRefund).not.toHaveBeenCalled()
    },
  )

  it.todo('[NON-TESTABLE: UI navigateur] bouton « Annuler » de /orders opérateur (confirmation, absence de saisie de motif) — hors harnais node')
})
