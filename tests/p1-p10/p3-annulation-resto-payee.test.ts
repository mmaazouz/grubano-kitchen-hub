import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P3 — restaurant cancels a PAID order — ÉTAT VAGUE 4 (P0-08) ───────────────
// PATCH /api/orders/[id]/status → 'cancelled' on an order with paymentStatus='paid'.
//
// Sprint 0 photographed the audit defect « annuler une commande payée garde
// l'argent » (constat RE-CONFIRMÉ en exécution le 06/08). P0-08 closes it the
// Q3 way — a REQUEST, never a refund:
//   - paid + cancelled → the order update AND a SYSTEM claim (status
//     'arbitration', reason 'system_order_cancelled', montant = total) are
//     committed in the SAME prisma.$transaction (atomicité) ; the admin decides
//     via the proven arbitration circuit — NO refund lib is EVER called from
//     this route (Q3 absolu, the spies below still must NEVER fire) ;
//   - the paid-cancellation EMAIL is the honest localized one
//     (sendOrderCancelledPaidEmail — demande transmise, décision humaine à
//     venir, AUCUN remboursement promis) ; an UNPAID cancellation keeps the
//     historic sendOrderStatusEmail path byte-identical ;
//   - replay / already-active claim → P2002 on activeOrderKey is a designed
//     no-op (no doublon, cancellation proceeds) ; any OTHER claim failure
//     rolls back the cancellation (both fail together).
//   - state machine, guards, loyalty: unchanged.

const hasStripe = !!process.env.STRIPE_SECRET_KEY // presence only — value never shown

const { db, getToken, resolveScope, sendEmail, cancelledPaidEmail, refundPayment, executeRefund } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    claim:              { create: vi.fn() }, // P0-08 — la demande système (lib/claims RÉELLE)
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    $transaction:       vi.fn(),
  },
  getToken:      vi.fn(),
  resolveScope:  vi.fn(),
  sendEmail:     vi.fn(),
  cancelledPaidEmail: vi.fn(), // P0-08 — l'email honnête des annulations PAYÉES
  refundPayment: vi.fn(), // spy on '@/lib/refunds' — must stay UNCALLED (Q3: request, never a refund)
  executeRefund: vi.fn(), // spy on '@/lib/refund'  — idem
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: sendEmail }))
vi.mock('@/lib/claim-emails', () => ({ sendOrderCancelledPaidEmail: cancelledPaidEmail }))
// Both refund libs are mocked so that ANY (even transitive — lib/claims réelle
// les importe) call would be captured. The spies must NEVER fire from a cancel.
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
  // P0-08 (durci en revue) : la branche demande-système est gatée isClaimsEnabled()
  // comme TOUS les écrivains de Claim — les tests du chemin payé stubbent le set
  // bêta réel (CLAIMS ON) ; le test « flag OFF » couvre le chemin historique.
  vi.stubEnv('CLAIMS_ENABLED', 'true')
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue(scopeOk())
  db.order.findUnique.mockResolvedValue(paidOrder())
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) =>
    Promise.resolve({ id: 'o1', status: data.status, updatedAt: new Date('2026-07-27T10:00:00Z') }))
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue(null)   // → loyalty + email lookups skip cleanly
  db.restaurant.findUnique.mockResolvedValue(null)
  sendEmail.mockResolvedValue({ status: 'sent' })
  cancelledPaidEmail.mockResolvedValue({ status: 'sent' })
  // P0-08 — $transaction interactive : exécute le callback avec tx = db (fidèle
  // au contrat Prisma pour ces spies) ; la forme tableau reste supportée.
  db.claim.create.mockResolvedValue({ id: 'clsys1' })
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof db) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]))
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

  it('[PASS-ACTUEL P0-08 — INVERSION, état VOULU Q3] lib/refunds et lib/refund ne sont JAMAIS appelés — une DEMANDE d’arbitrage est créée à la place', async () => {
    // Sprint 0 photographed this as the audit defect (money stays captured with no
    // compensating flow). P0-08 makes the no-refund behavior the WANTED one (Q3:
    // no money out without a human) and adds the missing compensating flow: a
    // SYSTEM claim lands directly in the admin arbitration queue.
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(refundPayment).not.toHaveBeenCalled()
    expect(executeRefund).not.toHaveBeenCalled()
    expect(db.claim.create).toHaveBeenCalledTimes(1)
    expect(db.claim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId:              'o1',
        consumerId:           'c1',
        restaurantId:         'r1',
        reason:               'system_order_cancelled',
        status:               'arbitration',           // directement la file admin
        requestedAmountCents: 4250,                    // total 42,50 € → montant INTÉGRAL
        activeOrderKey:       'o1',                    // @unique → anti-doublon
      }),
    })
  })

  it('[PASS-ACTUEL P0-08 — INVERSION] l’update n’écrit toujours QUE { status } ; la trace argent est la DEMANDE, dans la MÊME transaction', async () => {
    // paymentStatus is still not flipped here by design — the money-side trace is
    // now the arbitration claim, committed atomically with the cancellation; the
    // eventual refund (admin decision) flips paymentStatus via the webhook ledger.
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(db.order.update).toHaveBeenCalledTimes(1)
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data:  { status: 'cancelled' },
    })
    expect(db.$transaction).toHaveBeenCalledTimes(1) // atomicité annulation+demande
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
  })

  it('[PASS-ACTUEL P0-08] REJEU / réclamation déjà active : P2002 → l’annulation passe (200), AUCUN doublon, cas TRACÉ, email VÉRIDIQUE (existingClaim)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.claim.create.mockRejectedValue({ code: 'P2002' })
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(refundPayment).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[P0-08]'))
    // Revue : l'email ne dit PLUS « demande transmise » quand elle n'existe pas —
    // il dit que la réclamation EN COURS porte la question du remboursement.
    expect(cancelledPaidEmail).toHaveBeenCalledWith(expect.objectContaining({ existingClaim: true }))
    warnSpy.mockRestore()
  })

  it('[PASS-ACTUEL P0-08] CLAIMS_ENABLED OFF → chemin HISTORIQUE byte-identique (pas de demande, email générique) — la demande serait invisible et intranchable', async () => {
    vi.stubEnv('CLAIMS_ENABLED', '')
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(db.claim.create).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(cancelledPaidEmail).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('[PASS-ACTUEL P0-08] ATOMICITÉ : une panne (non-P2002) de la création de demande fait échouer l’annulation AUSSI (500, les deux ensemble)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.claim.create.mockRejectedValue(new Error('db down'))
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(500)
    expect(cancelledPaidEmail).not.toHaveBeenCalled() // pas d'email pour une annulation non commise
    errSpy.mockRestore()
  })

  it('[PASS-ACTUEL P0-08] commande NON payée annulée → AUCUNE demande créée, chemin historique byte-identique (email générique)', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ paymentStatus: null }))
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(db.claim.create).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(cancelledPaidEmail).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  // ── Cancellation email ─────────────────────────────────────────────────────

  it('[PASS-ACTUEL P0-08 — INVERSION] annulation PAYÉE → l’email HONNÊTE (sendOrderCancelledPaidEmail) part, PAS l’email générique muet sur l’argent', async () => {
    // Sprint 0 photographed the generic status email (« contactez directement le
    // restaurant », nothing about the money — re-confirmed in execution 06/08).
    // P0-08: the paid cancellation sends the localized honest email instead
    // (demande transmise à Grubano, décision humaine — no refund promised).
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
    const res = await patch('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(cancelledPaidEmail).toHaveBeenCalledTimes(1)
    expect(cancelledPaidEmail).toHaveBeenCalledWith({
      orderId: 'o1', consumerId: 'c1', restaurantName: 'Gnocchi Bar', existingClaim: false,
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] échec de l’email d’annulation NON bloquant → 200 quand même (best-effort)', async () => {
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    cancelledPaidEmail.mockRejectedValue(new Error('smtp down'))
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
