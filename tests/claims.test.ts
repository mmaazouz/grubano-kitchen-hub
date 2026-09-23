import { describe, it, expect, beforeEach, vi } from 'vitest'
import { updateManyMock } from './support/prisma-where'
import { Prisma } from '@prisma/client'

// ── P4.5-C1 — lib/claims (the claim cycle workflow) ──────────────────────────────
// Owner-scoped create, restaurant accept / refuse, the silence sweep, and the
// refund-trigger idempotence (executeRefund at most once per claim). Prisma + the
// P4.5-A engine are mocked.
// P0-24 (vague 1, Q3 volet 2) : l'ACCEPT restaurateur ne déclenche PLUS de
// remboursement — il route la réclamation en file admin ('arbitration').
// D′ L2 (spec v2 S-02/S-13, T-07/T-08) : l'admin DÉCIDE (arbitrateClaim = décision métier seule,
// jamais le moteur) ; le RAIL paie (triggerClaimRefund, inchangé T1..T4, appelé ici À LA MAIN pour
// garder ces chemins testés et comme contrôle négatif). La balayeuse (runClaimAutoApproval)
// n'approuve plus : elle ROUTE le silence échu vers 'arbitration' et ne pousse plus rien au moteur.

const { db } = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn() },
    claim: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    refund: { findUnique: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
// ROUND 13 (C3): the approval path reads Stripe before the engine — never the real Stripe.
const { stripeMock } = vi.hoisted(() => ({ stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))

import { createClaim, respondToClaim, runClaimAutoApproval, getClaimEligibility, arbitrateClaim, listArbitrationQueue, triggerClaimRefund } from '@/lib/claims'
import { APPROVE_CONFIRM_WORD, APPROVE_CONFIRM_REQUIRED, APPROVE_AMOUNT_REQUIRED } from '@/lib/claim-action-rules'
import { payableWorld, wireWorld, refundRow, claimOf, engineOk, engine202 } from './support/claims-world'

/** ROUND 13 (C3): T1 → T2 on fresh reads → the engine → T4, driven in an in-memory world. */
const world = (claim: Record<string, unknown>, chargeCents = 6000) => {
  const w = payableWorld(claim)
  w.pis.pi_1.latest_charge.amount = chargeCents
  w.pis.pi_1.latest_charge.amount_captured = chargeCents
  wireWorld(w, db, stripeMock)
  execMock.mockResolvedValue(engineOk({ refundId: 'rf1', stripeRefundId: 're_1' }))
  return w
}

const paidOrder = (o: Record<string, unknown> = {}) => ({
  id: 'o1', consumerId: 'c1', restaurantId: 'r1', paymentStatus: 'paid', total: 50, updatedAt: new Date(), ...o,
})
const fx = { row: null as Record<string, unknown> | null, updateManyCount: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [db.refund.findFirst, db.franchiseRoyalty.findFirst, db.claim.findMany]) m.mockReset()
  fx.updateManyCount = 1; fx.row = null;
  db.order.findUnique.mockResolvedValue(paidOrder())
  // Claims batch 1: the claim amount is now DERIVED (order lines minus what is already refunded).
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  // T-51: a claim may only be reported settled by a refund carrying ITS identity. The engine
  // mock returns row 'rf1', so the fixture row must be stamped for this claim — otherwise the
  // guard fails closed (which is the point) and every binding becomes a resume_mismatch.
  db.refund.findUnique.mockResolvedValue({ id: 'rf1', reason: 'claim:cl1', status: 'succeeded' })
  db.refund.findMany.mockResolvedValue([])
  db.claim.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cl1', ...data }))
  db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', restaurantId: 'r1', status: 'restaurant_review', requestedAmountCents: 5000 })
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.findMany.mockResolvedValue([])
  db.claim.update.mockResolvedValue({})
  // GATE T-49: this mock used to ignore the where clause entirely, so every compare-and-set
  // exercised here (approveClaim, contestClaim, arbitrateClaim) was unverified — the guard
  // could match nothing and the test still passed. It now evaluates the clause whenever a
  // simulated row is supplied via fx.row; with fx.row null it keeps the previous permissive
  // behaviour so tests that never modelled a row are unaffected.
  // These suites name the forced count `updateManyCount`; adapt it rather than rename it
  // across every call site. Getters keep the fixture live between tests.
  db.claim.updateMany.mockImplementation(updateManyMock({
    get row() { return fx.row },
    get forcedCount() { return fx.updateManyCount },
  }))
  execMock.mockResolvedValue({ ok: true, refundId: 'rf1', stripeRefundId: 're_1' })
  refundsFlag.mockReturnValue(true)
})

describe('createClaim — (a) owner + paid + window + amount', () => {
  it('creates a restaurant_review claim (whole order when no amount), deadline set', async () => {
    const res = await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })
    expect(res.ok).toBe(true)
    const data = db.claim.create.mock.calls[0][0].data
    expect(data).toMatchObject({ orderId: 'o1', consumerId: 'c1', restaurantId: 'r1', reason: 'quality', requestedAmountCents: 5000, status: 'restaurant_review', activeOrderKey: 'o1' })
    expect(data.responseDeadlineAt instanceof Date).toBe(true)
  })

  it('non-owner → 403, no create', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ consumerId: 'someone_else' }))
    const res = await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })
    expect(res).toMatchObject({ ok: false, status: 403 })
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('not paid → 409', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ paymentStatus: 'pending' }))
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })).toMatchObject({ ok: false, status: 409 })
  })

  it('outside the 48h window → 409', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ updatedAt: new Date(Date.now() - 49 * 3600 * 1000) }))
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })).toMatchObject({ ok: false, status: 409 })
  })

  // Claims batch 1 — CONTRACT CHANGE (stricter): the client no longer sends an amount at
  // all, so 'amount over the total' cannot even be expressed. The old test asserted that an
  // over-cap amount was REJECTED. The new contract is stronger: a requested amount can only
  // REDUCE the claim below the server-derived ceiling, and can never raise it.
  it('a client amount ABOVE the ceiling is capped at the server value, not granted', async () => {
    const res = await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality', requestedAmountCents: 6000 })
    expect(res.ok).toBe(true)
    // 5000 = the server-derived whole-order authority, NOT the 6000 the client asked for
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(5000)
  })

  it('a client amount BELOW the ceiling is honoured verbatim (a partial claim stays partial)', async () => {
    const res = await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality', requestedAmountCents: 500 })
    expect(res.ok).toBe(true)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(500)
  })

  it('invalid reason → 400', async () => {
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'nonsense' })).toMatchObject({ ok: false, status: 400 })
  })

  it('duplicate active claim (P2002 on activeOrderKey) → 409', async () => {
    db.claim.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('respondToClaim — (b) accept → FILE ADMIN, jamais de remboursement (P0-24)', () => {
  it("owner accept → AUCUN executeRefund ; CAS restaurant_review → 'arbitration' (reconnaissance sans argent)", async () => {
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res.ok).toBe(true)
    expect(execMock).not.toHaveBeenCalled() // ⭐ critère P0-24 : zéro stripe.refunds.create
    const moved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'arbitration')
    expect(moved?.[0].where).toMatchObject({ id: 'cl1', status: 'restaurant_review' })
    expect(moved?.[0].data).toMatchObject({ status: 'arbitration', restaurantResponse: 'accepted' })
    // la décision d'argent n'est PAS prise : decidedBy/decidedAt absents de l'écriture
    expect(moved?.[0].data.decidedBy).toBeUndefined()
    // et activeOrderKey n'est pas touché (arbitration = statut ACTIF, verrou conservé)
    expect(moved?.[0].data.activeOrderKey).toBeUndefined()
    if (res.ok) expect(res.refund).toBeUndefined()
  })

  it('accept est indépendant du flag REFUNDS (ON comme OFF → même routage, zéro argent)', async () => {
    refundsFlag.mockReturnValue(true)
    await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    refundsFlag.mockReturnValue(false)
    await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(execMock).not.toHaveBeenCalled()
    expect(db.claim.updateMany.mock.calls.filter((c) => c[0]?.data?.status === 'arbitration')).toHaveLength(2)
  })

  it('(IDOR) a claim on another operator order → 404, no refund', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', restaurantId: 'OTHER', status: 'restaurant_review' })
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('double accept (lost the atomic guard) → 409, no refund', async () => {
    fx.updateManyCount = 0 // review→arbitration matched 0 rows (already handled)
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('(c) refuse → status refused + reason, NO refund', async () => {
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'refuse', reason: 'photo non concluante' })
    expect(res.ok).toBe(true)
    const refusedCall = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'refused')
    expect(refusedCall?.[0].data).toMatchObject({ status: 'refused', restaurantResponse: 'refused', restaurantResponseReason: 'photo non concluante', activeOrderKey: null })
    expect(execMock).not.toHaveBeenCalled()
  })
})

describe("(e) P0-24 → D′ L2 — l'ADMIN décide (décision seule) ; le RAIL paie (les deux rôles couverts)", () => {
  it("admin arbitrate approve sur une réclamation 'arbitration' (acceptée par le resto) → décision écrite, executeRefund ZÉRO fois, bail REFUNDS jamais lu, pas de champ refund (D′ L2 S-02)", async () => {
    // D′ L4 (T-07): the decision carries a RATIFIED amount, confirmed by hand and bounded by the request.
    const w = world({ status: 'arbitration', refundAttempted: false, arbitrationDecision: null, requestedAmountCents: 5000, approvedAmountCents: null })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'adm1', decision: 'approve', approvedAmountCents: 5000, confirm: APPROVE_CONFIRM_WORD })
    expect(res.ok).toBe(true)
    expect(res).not.toHaveProperty('refund')
    expect(execMock).not.toHaveBeenCalled()
    expect(refundsFlag).not.toHaveBeenCalled()
    expect(w.writes).toHaveLength(1)
    expect(claimOf(w)).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 5000, arbitratedBy: 'adm1', decidedBy: 'admin', refundAttempted: false, refundId: null, refundError: null })
  })

  // D′ L4 NEGATIVE CONTROL — the pre-L4 call shape (a decision with neither confirmation nor amount)
  // used to approve this very claim; it now writes NOTHING at all.
  it("CONTRÔLE NÉGATIF D′ L4 — l'ancien appel (sans confirmation ni montant) n'approuve plus rien : 400, ZÉRO écriture", async () => {
    const w = world({ status: 'arbitration', refundAttempted: false, arbitrationDecision: null, requestedAmountCents: 5000, approvedAmountCents: null })
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'adm1', decision: 'approve' }))
      .toMatchObject({ ok: false, status: 400, error: APPROVE_CONFIRM_REQUIRED })
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'adm1', decision: 'approve', confirm: APPROVE_CONFIRM_WORD }))
      .toMatchObject({ ok: false, status: 400, error: APPROVE_AMOUNT_REQUIRED })
    expect(w.writes).toHaveLength(0)
    expect(claimOf(w)).toMatchObject({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
    expect(execMock).not.toHaveBeenCalled()
  })

  it("CONTRÔLE NÉGATIF — le même monde, après cette décision, PAIE quand le rail (triggerClaimRefund) est appelé à la main : executeRefund UNE fois, sur le montant de la réclamation", async () => {
    const w = world({ status: 'arbitration', refundAttempted: false, arbitrationDecision: null, requestedAmountCents: 5000, approvedAmountCents: null })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'adm1', decision: 'approve', approvedAmountCents: 5000, confirm: APPROVE_CONFIRM_WORD })
    expect(res.ok).toBe(true)
    expect(execMock).not.toHaveBeenCalled()
    const t = await triggerClaimRefund('cl1')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 5000, reason: 'claim:cl1' })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf1' })
  })

  it("[PHASE 2 §15 A7] RAIL (après la décision) : moteur → variante PENDING (Stripe pas encore succeeded) : la réclamation reste 'refunding' avec refundId, AUCUN refundError, AUCUN retour à 'approved'", async () => {
    const w = world({ status: 'arbitration', refundAttempted: false, arbitrationDecision: null, requestedAmountCents: 5000, approvedAmountCents: null })
    execMock.mockImplementation(async () => { w.refunds.push(refundRow('rf1', { reason: 'claim:cl1', status: 'pending', stripeRefundId: 're_p' })); return engine202({ refundId: 'rf1', stripeRefundId: 're_p', amountCents: 5000, error: 'en attente' }) })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'adm1', decision: 'approve', approvedAmountCents: 5000, confirm: APPROVE_CONFIRM_WORD })
    expect(res.ok).toBe(true)
    expect(execMock).not.toHaveBeenCalled()                 // the decision reached no engine
    expect(w.writes).toHaveLength(1)                        // write 0 = the decision CAS
    const t = await triggerClaimRefund('cl1')               // write 1 = T1 token, then the T4 writes
    expect(t).toEqual({ state: 'pending', reason: 'stripe_pending', refundId: 'rf1' })
    // ROUND 13 (C5): the post-engine write is a CAS on the attempt token; the claim state is what it wrote.
    const updates = w.writes.slice(2).map((x) => x.data)
    expect(updates).toContainEqual({ refundId: 'rf1', refundError: null })
    expect(updates.some((d) => d.status === 'approved' || d.refundError)).toBe(false)
    expect(updates.some((d) => d.status === 'refunded')).toBe(false)
    expect(claimOf(w)).toMatchObject({ status: 'refunding', refundId: 'rf1', refundError: null })
  })

  it('HÉRITAGE pré-P0-24 : approved + refundAttempted=false → RATIFIABLE (approve = décision complétée, ZÉRO moteur) ; le rail, lui, paie ensuite (contrôle négatif)', async () => {
    const w = world({ id: 'cl9', orderId: 'o1', status: 'approved', refundAttempted: false, arbitrationDecision: null, arbitratedBy: null, arbitratedAt: null, decidedBy: null, decidedAt: null, requestedAmountCents: 1200, approvedAmountCents: null })
    execMock.mockResolvedValue(engineOk({ refundId: 'rf9' }))
    const res = await arbitrateClaim({ claimId: 'cl9', adminId: 'adm1', decision: 'approve', approvedAmountCents: 1200, confirm: APPROVE_CONFIRM_WORD })
    expect(res.ok).toBe(true)
    // le CAS de ratification exige refundAttempted:false ET refundId:null dans le WHERE (race-safe) et épingle les instants lus
    // D′ L4 (S-29) : il épingle AUSSI l'absence de montant — un montant déjà fixé n'est jamais réécrit.
    const meta = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.arbitrationDecision === 'approved')
    expect(meta?.[0].where).toMatchObject({ id: 'cl9', status: 'approved', refundAttempted: false, refundId: null, arbitratedAt: null, decidedAt: null, approvedAmountCents: null })
    expect(meta?.[0].data).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 1200, arbitratedBy: 'adm1', decidedBy: 'admin' })
    expect(execMock).not.toHaveBeenCalled()
    expect(claimOf(w, 'cl9')).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', refundAttempted: false, refundId: null })
    // contrôle négatif : le rail sur cette réclamation ratifiée → moteur UNE fois, sur 1200 c
    const t = await triggerClaimRefund('cl9')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf9' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 1200, reason: 'claim:cl9' })
  })

  it('HÉRITAGE : refundAttempted=true (argent peut-être parti) → 409, JAMAIS re-déclenché', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl8', status: 'approved', refundAttempted: true })
    const res = await arbitrateClaim({ claimId: 'cl8', adminId: 'adm1', decision: 'approve' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })

  // Claims batch 1 — the queue KEEPS its two historic sources and gains a third:
  // restaurant silence past the deadline (previously invisible for ever). The legacy
  // source is additionally locked against a SECOND arbitration (arbitrationDecision null).
  it("la file admin inclut 'arbitration', l'héritage approved non remboursé, ET le silence resto échu", async () => {
    db.claim.findMany.mockResolvedValue([])
    await listArbitrationQueue()
    const where = db.claim.findMany.mock.calls[0][0].where as { OR: Array<Record<string, unknown>> }
    expect(where.OR).toHaveLength(3)
    expect(where.OR[0]).toEqual({ status: 'arbitration' })
    // AUDIT FIX (P1): every UNPAID approval stays listed, decided or not. Filtering these on
    // arbitrationDecision:null removed the beta's most common money-owed row from the queue.
    expect(where.OR[1]).toEqual({ status: 'approved', refundAttempted: false })
    expect(where.OR[2]).toMatchObject({ status: 'restaurant_review' })
    expect(where.OR[2].responseDeadlineAt).toHaveProperty('lte')
  })
})

describe('(d) silence sweep (runClaimAutoApproval) — D′ L2 S-13: routes to arbitration, approves nothing, pays nothing', () => {
  it('expired restaurant_review → ROUTED to arbitration (no auto_timeout approval, restaurantResponse untouched, 0 engine)', async () => {
    const w = world({ status: 'restaurant_review', responseDeadlineAt: new Date(Date.now() - 3_600_000), arbitrationDecision: null, reason: 'quality', restaurantResponse: null })
    const summary = await runClaimAutoApproval()
    expect(summary).toEqual({ scannedExpired: 1, routedToArbitration: 1, skippedSafety: 0, skippedAlreadyHandled: 0 })
    expect(summary).not.toHaveProperty('autoApproved')
    expect(summary).not.toHaveProperty('refundsTriggered')
    expect(execMock).not.toHaveBeenCalled()
    expect(db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.decidedBy === 'auto_timeout')).toBeUndefined()
    expect(db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'approved')).toBeUndefined()
    expect(w.writes).toHaveLength(1)
    expect(w.writes[0]).toMatchObject({ where: { id: 'cl1', status: 'restaurant_review' }, data: { status: 'arbitration' }, count: 1 })
    expect(claimOf(w)).toMatchObject({ status: 'arbitration', restaurantResponse: null, arbitrationDecision: null })
    expect(claimOf(w).decidedBy).toBeUndefined()               // the sweep decides nothing — a human will
    expect(claimOf(w).decidedAt).toBeUndefined()
  })

  it('approved-but-unrefunded is NEVER driven by the sweep, REFUNDS on or not (step 2 is deleted); the rail run by hand still pays it (negative control)', async () => {
    const w = world({ status: 'approved', refundAttempted: false, arbitrationDecision: 'approved' })
    const summary = await runClaimAutoApproval()
    expect(summary).toEqual({ scannedExpired: 0, routedToArbitration: 0, skippedSafety: 0, skippedAlreadyHandled: 0 })
    expect(execMock).not.toHaveBeenCalled()
    expect(refundsFlag).not.toHaveBeenCalled()                  // the sweep does not even read the REFUNDS lease
    expect(w.writes).toEqual([])
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    // negative control: the SAME approved-unpaid claim is payable by the rail — the sweep simply no longer drives it
    const t = await triggerClaimRefund('cl1')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('REFUNDS off → the same empty summary, no executeRefund (nothing expired, nothing driven)', async () => {
    refundsFlag.mockReturnValue(false)
    db.claim.findMany.mockResolvedValue([]) // no expired
    const summary = await runClaimAutoApproval()
    expect(summary).toEqual({ scannedExpired: 0, routedToArbitration: 0, skippedSafety: 0, skippedAlreadyHandled: 0 })
    expect(execMock).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })
})

describe('getClaimEligibility', () => {
  it('owner + paid + window + no active → canClaim, max = order total cents', async () => {
    const e = await getClaimEligibility({ consumerId: 'c1', orderId: 'o1' })
    expect(e).toMatchObject({ canClaim: true, maxRefundableCents: 5000, existingClaim: null })
  })
  it('an ACTIVE claim already exists → canClaim false (active_claim)', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl0', status: 'restaurant_review' })
    const e = await getClaimEligibility({ consumerId: 'c1', orderId: 'o1' })
    expect(e).toMatchObject({ canClaim: false, reason: 'active_claim' })
  })
  it('not the owner → canClaim false (not_owner)', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ consumerId: 'other' }))
    expect(await getClaimEligibility({ consumerId: 'c1', orderId: 'o1' })).toMatchObject({ canClaim: false, reason: 'not_owner' })
  })
})

// ── GATE T-49 — THE CAS GUARDS IN THIS FILE ARE NOW ACTUALLY VERIFIED ────────────
// Until now the updateMany mock in this suite ignored the where clause entirely, so every
// compare-and-set it exercised was untested: the guard could match nothing and the test still
// passed. These are DIFFERENTIAL controls — they drive shipped code with a simulated row and
// assert an outcome the old blind mock could not produce.
describe('respondToClaim — the status guard is enforced, not assumed', () => {
  const claim = { id: 'cl1', orderId: 'o1', restaurantId: 'r1', status: 'restaurant_review', requestedAmountCents: 500, refundAttempted: false }

  it('a claim ALREADY out of restaurant_review cannot be refused a second time', async () => {
    // The CAS is `where: { id, status: 'restaurant_review' }`. Simulating a row that has moved
    // on must make it match zero rows. Under the blind mock this returned ok:true.
    db.claim.findUnique.mockResolvedValue({ ...claim, status: 'restaurant_review' })
    fx.row = { status: 'arbitration' } // the real row already advanced
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'refuse', reason: 'non' })
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('…and a claim still IN restaurant_review is accepted, so the guard is not a blanket refusal', async () => {
    db.claim.findUnique.mockResolvedValue({ ...claim })
    fx.row = { status: 'restaurant_review' }
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'refuse', reason: 'non' })
    expect(res.ok).toBe(true)
  })

  it('accept is guarded by the same predicate and no money moves either way', async () => {
    db.claim.findUnique.mockResolvedValue({ ...claim })
    fx.row = { status: 'refused' } // already decided
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })
})
